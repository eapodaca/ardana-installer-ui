// (c) Copyright 2017-2018 SUSE LLC
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
var signIn = require('./clmAdminConsoleServices.pageObject.js');
var CommonObjects = require('../../common/common.pageObject.js');

describe('CLM Admin Console Services', function() {

  var SignInPage = new signIn();
  var commonObjects = new CommonObjects();
  var default_timeout;

  var EC = protractor.ExpectedConditions;
  var isInformationVisible = EC.visibilityOf(commonObjects.information);
  var isArdanaVisible = EC.visibilityOf(commonObjects.ardana);
  var isLogoutVisible =  EC.visibilityOf(commonObjects.logout);
  var isSpinnerInvisible = EC.invisibilityOf(commonObjects.spinner);
  var isHeaderVisible = EC.visibilityOf(commonObjects.headerTitle);
  var isLoadingInvisible =  EC.invisibilityOf(commonObjects.loading);
  var errorMessage = EC.visibilityOf(commonObjects.errorModal)

  //condition to handle page loading
  var condition = EC.and(isLoadingInvisible, isSpinnerInvisible,
                            isHeaderVisible, isLogoutVisible);


  beforeEach(function() {
    browser.get('https://10.84.43.68:9085');
    browser.sleep(5000);
  });

  it('loads the app', function() {
    expect(browser.getTitle()).toEqual('SUSE Openstack Cloud');
  });

  it('should open details of ardana service', function() {
    //todo: username and password needs to be pulled from service.osrc
    commonObjects.username.sendKeys('admin');
    commonObjects.password.sendKeys('iGxa2mRD');
    commonObjects.login.click();
    browser.wait(condition, 100000);
    expect(browser.getTitle()).toEqual('CLM Admin Console');
    browser.wait(isInformationVisible, 100000);
    browser.wait(isArdanaVisible, 100000);
    commonObjects.openStackPackages.click();
    browser.wait(condition, 100000);
    commonObjects.suseOpenStackCloudPackages.click();
    browser.wait(condition, 100000);
    commonObjects.configuration.click();
    browser.wait(condition, 100000);
    commonObjects.roles.click();
    browser.wait(condition, 100000);
    commonObjects.logout.click();
  });

});
