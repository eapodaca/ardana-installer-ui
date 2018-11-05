// (c) Copyright 2018 SUSE LLC
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
import { translate } from '../../localization/localize.js';
import { PRE_DEPLOYMENT_PLAYBOOK, STATUS } from '../../utils/constants.js';
import BaseUpdateWizardPage from '../BaseUpdateWizardPage.js';
import { PlaybookProgress } from '../../components/PlaybookProcess.js';
import { ErrorBanner } from '../../components/Messages.js';
import { fetchJson, postJson } from '../../utils/RestUtils.js';


const PLAYBOOK_STEPS = [
  {
    label: 'Check version',
    playbooks: ['version']
  },
  {
    label: translate('deploy.progress.config-processor-run'),
    playbooks: ['config-processor-run.yml']
  },
  {
    label: translate('deploy.progress.ready-deployment'),
    playbooks: ['ready-deployment.yml']
  },
  // TODO: This is very confusing. The below playbook basically
  // runs the config-process and ready-deploymet.  Why is this
  // in here effectively twice? This should be cleaned up.
  {
    label: translate('deploy.progress.predeployment'),
    playbooks: [PRE_DEPLOYMENT_PLAYBOOK + '.yml']
  }
];

// TODO this is a placeholder to illustrate
// how the replace framework can function with multiple
// pages assembled dynamically. Later when real replace
// node stories are implemented, either update this
// page or remove it if it is not used eventually.
// Please refer to pages/AddServers where it has the latest
// framework process handling
class PrepareCompute extends BaseUpdateWizardPage {

  constructor(props) {
    super(props);

    this.state = {
      overallStatus: STATUS.UNKNOWN, // overall status of entire playbook and commit
      startPlayBook: false,
      invalidMsg: '',
    };
  }

  setNextButtonDisabled = () => this.state.overallStatus != STATUS.COMPLETE;

  componentDidMount() {
    // commit model changes
    const commitMessage = {'message': 'Committed via Ardana DayTwo Installer'};
    postJson('/api/v1/clm/model/commit', commitMessage)
      .then((response) => {
        if(this.props.enableNextButton) {
          this.props.enableNextButton(true);
        }
        this.setState({startPlayBook: true});
      })
      .catch((error) => {
        this.setState({
          overallStatus: STATUS.FAILED,
          invalidMsg: translate('update.commit.failure', error.toString())
        });
        if(this.props.enableNextButton) {
          this.props.enableNextButton(false);
        }
      });
  }

  updatePageStatus = (status) => {
    this.setState({overallStatus: status});
    if (status === STATUS.FAILED) {
      this.setState({invalidMsg: translate('server.replace.prepare.failure')});
    }
  }

  renderPlaybookProgress () {
    const playbooks = [
      {
        // TODO: Replace this demo function with *real* functionality
        name: 'version',
        action: ((logger) => {
          return fetchJson('/api/v1/clm/version')
            .then((response) => {
              logger('ardana-service version: '+response);
            });
        }),
      },
      {
        name: PRE_DEPLOYMENT_PLAYBOOK,
      }
    ];

    return (
      <PlaybookProgress
        updatePageStatus={this.updatePageStatus}
        updateGlobalState={this.props.updateGlobalState}
        playbookStatus={this.props.playbookStatus}
        steps={PLAYBOOK_STEPS}
        playbooks={playbooks}/>
    );
  }

  renderError () {
    return (
      <div className='banner-container'>
        <ErrorBanner message={this.state.invalidMsg}
          show={this.state.overallStatus === STATUS.FAILED}/>
      </div>
    );
  }

  render() {
    //if error happens, cancel button shows up
    let cancel =  this.state.overallStatus === STATUS.FAILED;
    return (
      <div className='wizard-page'>
        <div className='content-header'>
          {this.renderHeading(translate('server.replace.prepare'))}
        </div>
        <div className='wizard-content'>
          {this.state.startPlayBook && this.renderPlaybookProgress()}
          {cancel && this.renderError()}
        </div>
        {this.renderNavButtons(cancel)}
      </div>
    );
  }
}

export default PrepareCompute;