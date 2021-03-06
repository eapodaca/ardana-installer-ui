// (c) Copyright 2018-2019 SUSE LLC
/**
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
**/

import React from 'react';
import { isEmpty } from 'lodash';
import BaseUpdateWizardPage from './BaseUpdateWizardPage.js';
import { ActionButton } from '../components/Buttons.js';
import CollapsibleTable from '../components/CollapsibleTable.js';
import { LoadingMask } from '../components/LoadingMask.js';
import { ErrorMessage } from '../components/Messages.js';
import { translate } from '../localization/localize.js';
import UpdateServerPages from './UpdateServerPages';
import {
  MODEL_SERVER_PROPS_ALL, MODEL_SERVER_PROPS, REPLACE_SERVER_MAC_IPMI_PROPS }
  from '../utils/constants.js';
import {
  updateServersInModel, getMergedServer, addServerInModel, isComputeNode,
  removeServerFromModel, genUID }
  from '../utils/ModelUtils.js';
import { fetchJson, postJson, putJson, getReachability } from '../utils/RestUtils.js';
import ReplaceServerDetails from '../components/ReplaceServerDetails.js';
import { BaseInputModal, ConfirmModal, YesNoModal } from '../components/Modals.js';
import { getInternalModel } from './topology/TopologyUtils';
import { fromJS } from 'immutable';
import { isMonascaInstalled } from '../utils/MonascaUtils.js';
import { getHostFromCloudModel } from '../utils/ModelUtils.js';
import { ValidatingInput } from '../components/ValidatingInput.js';
import { setCachedEncryptKey } from '../utils/MiscUtils.js';

const DeleteServerProcessPages = [
    {
      name: 'DeleteComputeHost',
      component: UpdateServerPages.DeleteComputeHost
    }
  ],
  DeactivateServerProcessPages = [
    {
      name: 'DeactivateComputeHost',
      component: UpdateServerPages.DeactivateComputeHost
    }
  ],
  ActivateServerProcessPages = [
    {
      name: 'ActivateComputeHost',
      component: UpdateServerPages.ActivateComputeHost
    }
  ];

class UpdateServers extends BaseUpdateWizardPage {

  constructor(props) {
    super(props);

    this.state = {
      ...this.state,
      loading: false,
      validating: undefined, // Will have a text when validating
      errorMessages: [],

      // Track which groups the user has expanded
      expandedGroup: props.expandedGroup || [],

      // servers that were discovered or manually entered
      servers: [],

      showReplaceModal: false,

      showSharedWarning: false,

      serverToReplace: undefined,

      // error message show as a popup modal for validation errors
      validationError: undefined,
      // need the expanded model to match up server info for Nova and Monasca
      internalModel: undefined,        // a copy of the full internal model for matching up hostnames
      monasca: undefined,               // whether monasca is installed
      serverMonascaStatuses: {},

      // current user that run the UI
      osUsername: undefined
    };
  }

  componentDidUpdate(prevProps, prevState, snapshot) {
    if (this.state.expandedGroup?.length === 0) {
      const allGroups =
        this.props.model?.getIn(['inputModel', 'server-roles']).map(e => e.get('name'));
      if (allGroups?.includes('COMPUTE-ROLE')) {
        this.setState({expandedGroup: ['COMPUTE-ROLE']});
      } else if (allGroups?.size > 0) {
        this.setState({expandedGroup: [allGroups.sort().first()]});
      }
    }
  }

  async componentDidMount() {
    // empty string loading indicates loading mask without
    // text
    this.setState({loading: true});
    try {
      try {
        const servers = await fetchJson('/api/v2/server?source=sm,ov,manual');
        this.setState({ servers });
      } catch(error) {
        let msg = translate('server.retrieve.discovered.servers.error', error.toString());
        this.setState(prev => {
          return {
            errorMessages: [
              ...prev.errorMessages,
              msg
            ]
          };
        });
      }
      if(!this.state.internalModel) {
        const model = await getInternalModel();
        this.setState({ internalModel: fromJS(model) });
      }
      if(!this.state.osUsername) {
        this.getUsername();
      }
      let promises = [
        this.getServerStatuses(),
        this.checkMonasca()
      ];
      await Promise.all(promises);
      this.setState({ loading: false });
    } catch(error) {
      this.setState(prev => {
        const msg = translate('server.retreive.serverstatus.error', error.toString());
        return {
          errorMessages: [
            ...prev.errorMessages,
            msg
          ],
          loading: false
        };
      });
    }
  }

  async getUsername() {
    let response = await fetchJson('/api/v2/user');
    if(response?.username) {
      this.setState({osUsername: response['username']});
    }
  }

  async hasInstances(server) {
    let oldHost =
      getHostFromCloudModel(this.state.internalModel.toJS(), server.id);
    try {
      let response = await fetchJson('/api/v2/compute/instances/' + oldHost.hostname);
      if (response?.length > 0) {
        return true;
      }
      else {
        return false;
      }
    }
    catch(error) {
      this.setState({oldServerCheckInstancesError: error.toString()});
      // If failed to check instances, will always to run instances
      // migration or evacuation
      return true;
    }
  }

  /**
   * checks to see if Monasca is installed, and if it is, triggers a call to the status
   * of each server in the model
   */
  async checkMonasca() {
    if(this.state.monasca === undefined) {
      //default state.monasca to false, primarily to short circuit additional checks
      //this is because componentDidMount and componentDidUpdate both call into this
      //depending on how the page was navigated to... removing either of those calls results
      //in some cases where this function never gets called... keeping both results in it
      //usually being called twice, setting the state to false (from its original value of
      //undefined) prevents the 2nd call from duplicating the check and model load
      this.setState({monasca: false});
      let isInstalled = await isMonascaInstalled();
      if(isInstalled) {
        this.setState({monasca: true}, () => this.getServerMonascaStatuses());
      }
    } else if(this.state.monasca === true) {
      //if monasca is installed, get the server statuses
      this.getServerMonascaStatuses();
    }
  }

  /**
  * takes a List (immutable) of serverIds, serially requests server status on each
  * the serial nature is to avoid flooding the monasca API with status requests
  */
  async throttledServerStatusRequest(serverIds) {
    let internalModelServers = this.state.internalModel?.getIn(['internal', 'servers']).toJS();
    for (const server_id of serverIds.values()) {
      let server = internalModelServers?.find(s => s.id == server_id);
      if (!server) continue;
      try {
        const responseData = await fetchJson('/api/v2/monasca/server_status/' + server.hostname);
        this.setMonascaStatus(server_id, responseData.status);
      } catch(error) {
        this.setMonascaStatus(server_id);
        console.log('error getting server status for:' + server.hostname + // eslint-disable-line no-console
          ' -- error is:' + error);
      }
    }
  }

  /**
   * Update the translated status of a server status
   * @param {String} server_id The id of the server
   * @param {String} status The current status of the server
   */
  setMonascaStatus(server_id, status) {
    this.setState(prevState => {
      let { serverMonascaStatuses } = prevState,
        translationKey = `server.details.status.${status}`;
      serverMonascaStatuses[server_id] = status ? translate(translationKey) : null;
      if(serverMonascaStatuses[server_id] === null || serverMonascaStatuses[server_id] === translationKey) {
        serverMonascaStatuses[server_id] = translate('server.details.status.unknown');
      }
      return { serverMonascaStatuses };
    });
  }

  /**
   * get the monasca status (up/down/unknown) for each server in the cloud
   */
  getServerMonascaStatuses() {
    if(this.state.monasca && this.state.internalModel !== undefined
        && this.props.model !== undefined) {
      // get the list of all servers, then load their statuses
      // possible future enhancement: batching this
      const serverIds = this.props.model?.getIn(['inputModel','servers'])
        .map(server => server.get('id'));

      this.throttledServerStatusRequest(serverIds);
    }
  }

  async getServerStatuses() {
    let internalModelServers = this.state.internalModel?.getIn(['internal', 'servers']).toJS();
    let servers = this.props.model?.getIn(['inputModel','servers']).toJS()
      .filter(s => s.role.includes('COMPUTE'))
      .map(s => {
        const internalServer = internalModelServers.filter(sev => sev.id === s.id)[0];
        if(internalServer !== undefined) {
          return {
            ...s,
            internal: {
              ...internalServer,
              ansible_hostname: internalServer.hostname
            },
            hostname: internalServer.hostname
          };
        } else {
          console.log( // eslint-disable-line no-console
            `possible model inconsistency, internal model missing server id: ${s.id}`
          );
        }
      });

    let serversStatus = servers.map(s => {
      if(s) {
        return fetchJson(`/api/v2/compute/services/${s.hostname}`);
      }
    });
    const values = await Promise.all(serversStatus);
    let serverStatuses = {};
    for(const [index, status] of values.entries()) {
      const server = servers[index];
      if(server) {
        serverStatuses[server.id] = {
          ...server,
          status: status['nova-compute']
        };
      }
    }
    this.setState({serverStatuses});
  }

  setExpandedGroup(expandedGroup) {
    this.setState({ expandedGroup });
    this.props.updateGlobalState('expandedGroup', expandedGroup);
  }

  expandAll() {
    const allGroups =
      this.props.model.getIn(['inputModel','server-roles']).map(e => e.get('name'));
    this.setExpandedGroup(allGroups);
  }

  collapseAll() {
    this.setExpandedGroup();
  }

  removeExpandedGroup = (groupName) => {
    let groups = (this.state.expandedGroup || []).filter(e => e != groupName);
    this.setExpandedGroup(groups.length > 0 ? groups : undefined);
  }

  addExpandedGroup = (groupName) => {
    this.setExpandedGroup((this.state.expandedGroup || []).concat(groupName));
  }

  getReplaceProps = () => {
    if(isComputeNode(this.state.serverToReplace)) {
      return MODEL_SERVER_PROPS;
    }
    else {
      return REPLACE_SERVER_MAC_IPMI_PROPS;
    }
  }

  updateServerForReplaceServer = (server) => {
    let old = this.state.servers.find(s => server.uid === s.uid);
    if (old) {
      const updated_server = getMergedServer(old, server, this.getReplaceProps());
      putJson('/api/v2/server', updated_server)
        .catch(error => {
          let msg = translate('server.save.error', error.toString());
          this.setState(prev => ({ errorMessages: prev.errorMessages.concat(msg)}));
        });
    }
    // for compute host replacement, user added info manually, will add to
    // to saved servers
    else if(isComputeNode(this.state.serverToReplace)) {
      server['source'] = 'manual';
      postJson('/api/v2/server', [server])
        .catch(error => {
          let msg = translate('server.save.error', error.toString());
          this.setState(prev => ({ errorMessages: prev.errorMessages.concat(msg)}));
        });
    }
    // for non-compute host replacement, if user added info manually, won't
    // save to saved servers
  }

  assembleReplaceServerProcessPages = (theProps) => {
    let pages = [];

    if(isComputeNode(this.state.serverToReplace)) {
      if(theProps.installOS) {
        pages.push({
          name: 'InstallOS',
          component: UpdateServerPages.InstallOS
        });
      }
      pages.push({
        name: 'PrepareAddCompute',
        component: UpdateServerPages.PrepareAddCompute
      });
      pages.push({
        name: 'DeployAddCompute',
        component: UpdateServerPages.DeployAddCompute
      });
      pages.push({
        name: 'DisableComputeServiceNetwork',
        component: UpdateServerPages.DisableComputeServiceNetwork
      });
      pages.push({
        name: 'DeleteCompute',
        component: UpdateServerPages.DeleteCompute
      });
      pages.push({
        name: 'CompleteReplaceCompute',
        component: UpdateServerPages.CompleteReplaceCompute
      });
    } else {
      pages.push({
        name: 'ReplaceController',
        component: UpdateServerPages.ReplaceController
      });
    }
    return pages;
  }

  // server includes server info and ipmi info
  // theProps includes zero or more of the items like
  // wipeDisk, installOS, osUsername, osPassword,
  // selectedServerId
  replaceServer = async (server, theProps) =>  {
    let model;

    let repServer = Object.assign({}, server);

    // the new server is from discovered servers or manual servers
    // need to update
    if(theProps.selectedServerId) {
      // update internal uuid for UI purpose
      let selServer =
        this.state.servers.find(svr => svr.id === theProps.selectedServerId);
      repServer['uid'] = selServer['uid'];
    }
    else {
      // user input new mac-addr and ilo info
      // generate a new uid, treat it as manual added server
      repServer['uid'] = genUID('manual');
    }

    // if compute node, will add server to the model
    if(isComputeNode(this.state.serverToReplace)) {
      // get the old server's role
      repServer['role'] = this.state.serverToReplace['role'];
      model = addServerInModel(repServer, this.props.model, MODEL_SERVER_PROPS_ALL);
    }
    else { // update existing server
      model =
        updateServersInModel(repServer, this.props.model, MODEL_SERVER_PROPS_ALL, repServer.id);
    }

    this.updateServerForReplaceServer(repServer);

    // Update the global state. Since this saves the model and updates the state, wait for
    // it to complete before moving on.
    await this.props.updateGlobalState('model', model);

    // save the encryptKey in global cache so it could be retrieved later
    if(this.props.isEncrypted) {
      await setCachedEncryptKey(theProps.encryptKey);
    }

    // existing server id and ip-addr for non-compute node
    // new server id and ip-addr for a new compute node
    // for replacing a compute node, also recorded oldServer's id
    // and ip-addr
    // id and ip-addr can be used to retrieve hostname in CloudModel.yml
    theProps.server = {id: repServer.id, 'ip': repServer['ip-addr']};

    // save the oldServer information for later process when replace compute
    if(isComputeNode(this.state.serverToReplace)) {
      theProps.oldServer = {
        id: this.state.serverToReplace['id'], 'ip': this.state.serverToReplace['ip-addr'],
        isReachable: this.state.isOldServerReachable, hasInstances: this.state.oldServerHasInstances
      };
      // will always activate the newly added compute server
      theProps.activate = true;
    }

    let pages = this.assembleReplaceServerProcessPages(theProps);

    if(isComputeNode(this.state.serverToReplace)) {
      this.setState({validating: translate('server.validating')});
      postJson('/api/v2/config_processor')
        .then(() => {
          this.setState({validating: undefined});
          this.props.startUpdateProcess('ReplaceServer', pages, theProps);
        })
        .catch((error) => {
          // when validation failed, show error messages and
          // instruct users to update and do replace again.
          this.setState({validating: undefined});
          this.setState({validationError: error.value ? error.value.log : error.toString()});
          // remove the server from model
          // remove role of the server in the availabe server list
          this.updateInvalidComputeServer(repServer);

        });
    }
    else {
      // trigger update process to start which calls the startUpdate in
      // UpdateWizard
      this.props.startUpdateProcess('ReplaceServer', pages, theProps);
    }
  }

  updateInvalidComputeServer = (server) => {
    let model = removeServerFromModel(server, this.props.model);
    this.props.updateGlobalState('model', model);
    // remove role and update servers list
    server['role'] = '';
    let old = this.state.servers.find(s => server.uid === s.uid);
    if (old) {
      const updated_server = getMergedServer(old, server, MODEL_SERVER_PROPS_ALL);
      let servers = this.state.servers.filter(s => server.uid !== s.uid);
      servers.push(updated_server);
      this.setState({'servers': servers});
      putJson('/api/v2/server', updated_server)
        .catch(error => {
          let msg = translate('server.save.error', error.toString());
          this.setState(prev => ({ errorMessages: prev.errorMessages.concat(msg)}));
        });
    }
  }

  async deleteComputeHost(id) {
    let server = this.state.serverStatuses[id];
    this.setState({
      confirmDelete: {
        show: true,
        loading: true,
        id: id,
        osPassword: ''
      }
    });
    try {
      let conectivityStatus = await getReachability(server['ip-addr']);
      this.setState(prev => ({
        serverStatuses: {
          ...prev.serverStatuses,
          [id]: {
            ...prev.serverStatuses[id],
            internal: {
              ...prev.serverStatuses[id].internal,
              isReachable: conectivityStatus
            }
          }
        },
        confirmDelete: {
          ...prev.confirmDelete,
          loading: false
        }
      }));
    }
    catch (error) {
      let msg = translate('server.delete.error', error.toString());
      this.setState({
        errorMessages: [
          ...this.state.errorMessages,
          msg
        ],
        confirmDelete: undefined
      });
    }
  }

  performDeleteComputeHost() {
    let { id, osPassword } = this.state.confirmDelete;
    const theProps = {
      oldServer: this.state.serverStatuses[id].internal,
      osPassword: osPassword
    };
    this.setState({
      confirmDelete: undefined
    });
    this.props.startUpdateProcess('DeleteServer', DeleteServerProcessPages, theProps);
  }

  async activateComputeHost(id) {
    const  props = {
      target: this.state.serverStatuses[id].internal
    };
    this.props.startUpdateProcess('ActivateServer', ActivateServerProcessPages, props);
  }

  async deactivateComputeHost(id) {
    let server = this.state.serverStatuses[id];
    this.setState({
      confirmDeactivate: {
        show: true,
        loading: true,
        id: server.id
      }
    });
    try {
      let promises = [
        fetchJson(`/api/v2/compute/instances/${server.hostname}`),
        getReachability(server['ip-addr'])
      ];
      let [ instances, conectivityStatus ] = await Promise.all(promises);
      this.setState(prev => ({
        serverStatuses: {
          ...prev.serverStatuses,
          [id]: {
            ...prev.serverStatuses[id],
            internal: {
              ...prev.serverStatuses[id].internal,
              isReachable: conectivityStatus
            }
          }
        },
        confirmDeactivate: {
          ...prev.confirmDeactivate,
          loading: false,
          instances
        }
      }));
    } catch (error) {
      let msg = translate('server.deactivate.error', error.toString());
      this.setState({
        errorMessages: [
          ...this.state.errorMessages,
          msg
        ],
        confirmDeactivate: undefined
      });
    }
  }

  async performDeactivateAndOrMigration() {
    let props = {
      oldServer: this.state.serverStatuses[this.state.confirmDeactivate.id].internal
    };

    if (this.state.confirmDeactivate.migrationTarget) {
      props.server = this.state.confirmDeactivate.migrationTarget;
    }

    this.setState({
      confirmDeactivate: undefined
    });

    this.props.startUpdateProcess('DeactivateServer', DeactivateServerProcessPages, props);
  }

  selectMigrationTarget(event) {
    const id = event.target.value,
      migrationTarget = this.state.serverStatuses[id].internal;

    this.setState((prev) => {
      return {
        confirmDeactivate: {
          ...prev.confirmDeactivate,
          migrationTarget,
          migrationTargetId: id
        }
      };
    });
  }

  handleOsPasswordChangeForDelComp = (e) => {
    const value = e.target.value;
    this.setState(prev => ({
      confirmDelete: {
        ...prev.confirmDelete,
        osPassword: value
      }
    }));
  }

  renderDeactivateConfirmModal() {
    if (!this.state.confirmDeactivate || !this.state.confirmDeactivate.show) return;
    const { id, instances, loading, migrationTargetId } = this.state.confirmDeactivate,
      haveInstances = instances?.length > 0;

    let choices = [], otherHosts = [];

    if (haveInstances) {
      otherHosts = Object.keys(this.state.serverStatuses)
        .filter(id => id !== this.state.confirmDeactivate?.id);
      choices =
        otherHosts.map(id => {
          const server = this.state.serverStatuses[id];
          return <div key={server.id} className="form-check">
            <input className="form-check-input" type="radio" name={server.id} id={server.id}
              value={server.id} checked={migrationTargetId === server.id}
              onChange={::this.selectMigrationTarget}/>
            <label className="form-check-label" htmlFor={server.id}>
              {server.id}
            </label>
          </div>;
        });
    }

    return (
      <YesNoModal
        title={translate('server.deactivate.confirm.title', id)}
        yesAction={::this.performDeactivateAndOrMigration}
        noAction={() => this.setState({confirmDeactivate: undefined})}
        disableYes={loading || (!loading && haveInstances && !migrationTargetId && otherHosts.length > 0)}
      >
        <p>
          <If condition={loading}>
            {translate('loading.pleasewait')}
          </If>
          <If condition={!loading && instances?.length > 0 && otherHosts.length > 0}>
            {translate('server.deactivate.confirm.message_instances', id, instances.length)}
          </If>
          <If condition={!loading && instances?.length > 0 && otherHosts.length === 0}>
            {translate('server.deactivate.confirm.message_instances_cant_be_migrated', id, instances.length)}
          </If>
          <If condition={!loading && instances?.length === 0}>
            {translate('server.deactivate.confirm.message', id)}
          </If>
        </p>
        <If condition={haveInstances && otherHosts.length > 0}>
          <p>{translate('server.migrate.prompt', id)}</p>
          {choices}
        </If>
      </YesNoModal>
    );
  }

  renderDeleteConfirmModal() {
    if (!this.state.confirmDelete || !this.state.confirmDelete.show) return;
    let { id, loading, osPassword } = this.state.confirmDelete;
    return (
      <YesNoModal
        title={translate('server.deploy.progress.delete_compute')} yesAction={::this.performDeleteComputeHost}
        noAction={() => this.setState({confirmDelete: undefined})}
        disableYes={loading || isEmpty(this.state.confirmDelete.osPassword)}
      >
        <div>
          <If condition={loading}>
            {translate('loading.pleasewait')}
          </If>
          <If condition={!loading}>
            {translate('server.delete.confirm.message', id)}
            <div className='password-line'>
              <div className='password-heading'>
                {translate('server.delete.ardana.password', this.state.osUsername) + '*'}
              </div>
              <div className='password-input'>
                <ValidatingInput isRequired='true' inputName='osPassword'
                  inputType='password' inputValue={osPassword}
                  inputAction={::this.handleOsPasswordChangeForDelComp}/>
              </div>
            </div>
          </If>
        </div>
      </YesNoModal>
    );
  }

  handleCloseMessage = (idx) => {
    this.setState((prevState) => {
      let msgs = prevState.errorMessages.slice();
      msgs.splice(idx, 1);
      return {errorMessages: msgs};
    });
  }

  handleCloseValidationErrorModal = () => {
    this.setState({validationError: undefined});
  }

  renderValidationErrorModal() {
    if (this.state.validationError) {
      return (
        <BaseInputModal
          className='addserver-log-dialog'
          onHide={this.handleCloseValidationErrorModal}
          title={translate('server.addcompute.validate.error.title')}>
          <div className='addservers-page'>
            <pre className='log'>{this.state.validationError}</pre></div>
        </BaseInputModal>
      );
    }
  }

  renderMessages() {
    let msgList = this.state.errorMessages.map((msg, idx) => {
      return (
        <ErrorMessage key={idx} closeAction={() => this.handleCloseMessage(idx)}
          message={msg}/>
      );
    });
    return (<div className='notification-message-container'>{msgList}</div>);
  }

  checkReplacePrereqs = (server) => {
    // Verify the prerequisites before prompting for replacement information:
    // - the selected controller node is not shared with the deployer
    // - the selected node is no longer reachable (via ssh)
    // - For replacing a compute node, we need to migrate instances
    // on the old compute node first, therefore it should be reachable.
    // If it is not reachable, show a warning indicating that instances can not
    // be migrated.
    fetchJson('/api/v2/ips')
      .then(ips => {
        if (ips.includes(server['ip-addr'])) {
          this.setState({showSharedWarning: true});
        }
        else {
          // Display the load mask without loading text
          this.setState({loading: true});

          postJson('api/v2/connection_test', {host: server['ip-addr']})
            .then(async(result) => {
              if(isComputeNode(server)) {
                // check if old server has instances when old server is reachable
                let oSvrHasInstances = await this.hasInstances(server);
                this.setState({
                  loading: false,
                  showReplaceModal: true,
                  serverToReplace: server,
                  isOldServerReachable: true,
                  oldServerHasInstances: oSvrHasInstances
                });
              }
              else {
                // If the node is still reachable, then display a message to the user to have them
                // power it down.
                this.setState({loading: false, showPowerOffWarning: true});
              }
            })
            .catch(async(error) => {
              if (error.status == 404) {
                if(isComputeNode(server)) {
                  this.setState({
                    serverToReplace: server,
                    isOldServerReachable: false
                  });
                  // check if old server has instances when old server is not reachable
                  let oSvrHasInstances = await this.hasInstances(server);

                  this.setState({loading: false});

                  // If the old compute is not reachable and has instances
                  // will show warning to make sure the compute hosts
                  // have shared storage if user wants to proceed.
                  // Or had errors to determine instances. Will show
                  // warning to indicate the error and make sure the compute
                  // hosts have shared storage if user wants to proceed.
                  if(oSvrHasInstances) {
                    this.setState({
                      oldServerHasInstances: oSvrHasInstances,
                      showComputeNotReachableWarning: true});
                  }
                  else {
                    // If the old compute is not reachable but has no instances
                    // will proceed
                    this.setState({
                      oldServerHasInstances: oSvrHasInstances,
                      showReplaceModal: true});
                  }
                }
                else {
                  console.log(   // eslint-disable-line no-console
                    'The 404 immediately preceding this message is expected, ' +
                    'and it means that the server is in the correct state (powered off)');
                  // 404 means the server is not found, which is the state that we *want* to be in.
                  // Proceed with the modal for entering the replacement info.
                  this.setState({
                    loading: false,
                    showReplaceModal: true,
                    serverToReplace: server
                  });
                }
              } else {
                let msg = translate('server.save.error', error.toString());
                this.setState(prev => ({
                  errorMessages: prev.errorMessages.concat(msg),
                  loading: false
                }));
              }
            });
        }
      });
  }

  handleCancelReplaceServer = () => {
    this.setState({showReplaceModal: false, serverToReplace: undefined});
  }

  handleDoneReplaceServer = async (server, theProps) => {
    await this.replaceServer(server, theProps);
    this.handleCancelReplaceServer();
  }

  proceedOldComputeNotReachable = () => {
    this.setState({
      showComputeNotReachableWarning: false, showReplaceModal: true});
  }

  cancelOldComputeNotReachable = () => {
    this.setState({
      showComputeNotReachableWarning: false, serverToReplace: undefined,
      oldServerCheckInstancesError: undefined
    });
  }

  renderSharedWarning() {
    if (this.state.showSharedWarning) {
      return (
        <ConfirmModal
          title={translate('warning')}
          onHide={() => this.setState({showSharedWarning: false})}>
          <div>{translate('replace.server.shared.warning')}</div>
        </ConfirmModal>
      );
    }
  }

  renderPowerOffWarning() {
    if (this.state.showPowerOffWarning) {
      return (
        <ConfirmModal
          title={translate('warning')}
          onHide={() => this.setState({showPowerOffWarning: false})}>
          <div>{translate('replace.server.poweroff.warning')}</div>
        </ConfirmModal>
      );
    }
  }

  renderComputeNotReachableWarning() {
    if (this.state.showComputeNotReachableWarning) {
      let warnMsg = '';
      // If we failed to get instances and user still chooses to
      // proceed, will treat it as it has instances and run
      // nova-host-evacuate playbook
      if(this.state.oldServerCheckInstancesError) {
        warnMsg = translate(
          'replace.server.compute.notreachable.instances.error.warning',
          this.state.serverToReplace['id'], this.state.serverToReplace['ip-addr'],
          this.state.oldServerCheckInstancesError);
      }
      else {
        warnMsg = translate(
          'replace.server.compute.notreachable.warning',
          this.state.serverToReplace['id'], this.state.serverToReplace['ip-addr']);
      }
      return (
        <YesNoModal title={translate('warning')}
          yesAction={this.proceedOldComputeNotReachable}
          noAction={this.cancelOldComputeNotReachable}>
          {warnMsg}
        </YesNoModal>
      );
    }
  }

  renderReplaceServerModal() {
    if (! this.state.serverToReplace) {
      return;
    }

    let newProps = { ...this.props };

    const modelIds = this.props.model?.getIn(['inputModel','servers'])
      .map(server => server.get('uid') || server.get('id'));

    newProps.availableServers = this.state.servers.filter(server => ! modelIds.includes(server.uid));

    return (
      <ReplaceServerDetails className='edit-details-dialog'
        title={translate('server.replace.heading', this.state.serverToReplace.id)}
        cancelAction={this.handleCancelReplaceServer}
        doneAction={this.handleDoneReplaceServer}
        data={this.state.serverToReplace} osUsername={this.state.osUsername}
        {...newProps}>
      </ReplaceServerDetails>
    );
  }

  renderCollapsibleTable() {
    let tableConfig = {
      columns: [
        {name: 'id'},
        {name: 'uid', hidden: true},
        {name: 'ip-addr',},
        {name: 'server-group'},
        {name: 'nic-mapping'},
        {name: 'mac-addr'},
        {name: 'monascaStatus', foundInProp: 'serverMonascaStatuses', hidden: !this.state.monasca},
        {name: 'ilo-ip', hidden: true},
        {name: 'ilo-user', hidden: true},
        {name: 'ilo-password', hidden: true},
        {name: 'role', hidden: true}
      ]
    };

    const autoServers = this.state.servers.filter(s => s.source !== 'manual');
    const manualServers = this.state.servers.filter(s => s.source === 'manual');

    // TODO: pass in array of menu items and callbacks
    return (
      <CollapsibleTable
        addExpandedGroup={this.addExpandedGroup} removeExpandedGroup={this.removeExpandedGroup}
        model={this.props.model} tableConfig={tableConfig} expandedGroup={this.state.expandedGroup}
        replaceServer={this.checkReplacePrereqs} updateGlobalState={this.props.updateGlobalState}
        autoServers={autoServers} manualServers={manualServers}
        processOperation={this.props.processOperation} serverStatuses={this.state.serverStatuses}
        activateComputeHost={::this.activateComputeHost} deactivateComputeHost={::this.deactivateComputeHost}
        serverMonascaStatuses={this.state.serverMonascaStatuses} internalModel={this.state.internalModel}
        deleteComputeHost={::this.deleteComputeHost}/>
    );
  }

  renderGlobalButtons() {
    return (
      <div className='buttonBox'>
        <div className='btn-row'>
          <ActionButton type='default'
            displayLabel={translate('collapse.all')} clickAction={() => this.collapseAll()} />
          <ActionButton type='default'
            displayLabel={translate('expand.all')} clickAction={() => this.expandAll()} />
        </div>
      </div>
    );
  }

  render() {
    return (
      <div className='wizard-page'>
        <LoadingMask show={this.props.wizardLoading || this.state.loading || this.state.validating}
          text={this.state.validating}/>
        <div className='content-header'>
          <div className='titleBox'>
            {this.renderHeading(translate('common.servers'))}
          </div>
          {this.props.model?.size > 0 && this.renderGlobalButtons()}
        </div>
        <div className='wizard-content unlimited-height'>
          {this.props.model?.size > 0 && this.renderCollapsibleTable()}
          {!this.props.wizardLoading && this.props.wizardLoadingErrors &&
           this.renderWizardLoadingErrors(
             this.props.wizardLoadingErrors, this.handleCloseLoadingErrorMessage)}
          {this.state.errorMessages.length > 0 && this.renderMessages()}
        </div>
        {this.state.showReplaceModal && this.renderReplaceServerModal()}
        {this.renderSharedWarning()}
        {this.renderPowerOffWarning()}
        {this.renderComputeNotReachableWarning()}
        {this.renderValidationErrorModal()}
        {this.renderDeactivateConfirmModal()}
        {this.renderDeleteConfirmModal()}
      </div>
    );
  }
}

export default UpdateServers;
