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
import { translate } from '../localization/localize.js';
import { safeLoad } from 'js-yaml';
import { List } from 'immutable';

const IPV4ADDRESS =
  /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const MACADDRESS =
  /^[0-9a-fA-F]{2}([:])(?:[0-9a-fA-F]{2}\1){4}[0-9a-fA-F]{2}$/;
const HOST = /^(?=^.{1,254}$)(^(?:(?!\d+\.)[a-zA-Z0-9_-]{1,63}\.?)+(?:[a-zA-Z]{2,})$)/;
const IPV4ADDRESS_HOST = new RegExp(
  IPV4ADDRESS.toString().slice(1, IPV4ADDRESS.toString().length-1) + '|' +
  HOST.toString().slice(1, HOST.toString().length-1)
);
const PORT = /^0*(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{1,3}|[0-9])$/;
const PCI_ADDRESS = /^[0-9a-fA-F]{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.[0-9a-fA-F]$/;
const NET_INTERFACE = /^[0-9a-zA-Z.:_]{1,16}$/;
const CIDR =
  /^((?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))\/(3[0-2]|[1-2]?[0-9])$/;
const NETMASK = new RegExp('^(' +
  /((255\.){3}(255|254|252|248|240|224|192|128|0+))|/.source +
  /((255\.){2}(255|254|252|248|240|224|192|128|0+)\.0)|/.source +
  /((255\.)(255|254|252|248|240|224|192|128|0+)(\.0+){2})|/.source +
  /((255|254|252|248|240|224|192|128|0+)(\.0+){3})/.source + ')$'
);
const IPV4ADDRESS_RANGE =
  /^(?:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\s*-\s*(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))$/;  //eslint-disable-line max-len

export function IpV4AddressValidator(ipAddress) {
  if(IPV4ADDRESS.exec(ipAddress) === null) {
    return translate('input.validator.ipv4address.error');
  }
}

export function MacAddressValidator(macAddress) {
  if(MACADDRESS.exec(macAddress) === null) {
    return translate('input.validator.macaddress.error');
  }
}

export function PortValidator(port) {
  if(PORT.exec(port) === null) {
    return translate('input.validator.port.error');
  }
}

export function IpV4AddressHostValidator(host) {
  if(IPV4ADDRESS_HOST.exec(host) === null) {
    return translate('input.validator.ipv4addresshost.error');
  }
}

export function PCIAddressValidator(str) {
  if(PCI_ADDRESS.exec(str) === null) {
    return translate('input.validator.pciaddress.error');
  }
}

export function NetworkInterfaceValidator(str) {
  if(NET_INTERFACE.exec(str) === null) {
    return translate('input.validator.networkinterface.error');
  }
}

export function VLANIDValidator(vlanid) {
  if(vlanid && vlanid <= 0 || vlanid > 4094) {
    return translate('input.validator.vlanid.error');
  }
}


// Convert an IP address (e.g. 10.1.0.24) into its equivalent integer (167837720)
function ipAddrToInt(ip) {
  // Split string into array of octets, converted to integers
  const octets = ip.split('.').map(n => parseInt(n, 10));

  // Convert to an integer.  The trailing >>> 0 converts the number to unsigned so we
  // don't get huge negative values
  return ((octets[0] << 24) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

export function CidrValidator(cidr) {
  const match = CIDR.exec(cidr);
  if(match === null) {
    return translate('input.validator.cidr.error');
  }

  // match[1] is the ip address, match[2] is number of leading bits (the part after the slash)
  const ip = ipAddrToInt(match[1]);
  const bits = parseInt(match[2]);

  // Verify that all of the values in the IP address portion after the leading
  // bits are zeros.  For example, the CIDR 192.168.1.0/24 would be an integer address
  // value of 0xC0A80100, and the last 8 bits (32-24) are required to be zeros.
  if ((ip & (0xffffffff >>> bits)) !== 0) {
    return translate('input.validator.cidr.error');
  }
}

export function AddressesValidator(addresses) {
  // just one IPV4 address
  if(addresses?.indexOf('-') === -1) {
    if(IPV4ADDRESS.exec(addresses.trim()) === null) {
      return translate('input.validator.addresses.error');
    }
  }

  if(addresses?.indexOf('-') !== -1) { // just one range
    if (IPV4ADDRESS_RANGE.exec(addresses.trim()) === null) {
      return translate('input.validator.addresses.error');
    }

    var ips = addresses.replace(/\s/g, '').split('-');
    var s_ip = ips[0];
    var e_ip = ips[1];
    var s_ip_num = ipAddrToInt(s_ip);
    var e_ip_num = ipAddrToInt(e_ip);

    if (s_ip_num >= e_ip_num) {
      return translate('input.validator.addresses.error');
    }
  }
}

export const UniqueNameValidator = (names) =>
  createExcludesValidator(names, translate('input.validator.uniquename.error'));
export const UniqueIdValidator = (ids) => createExcludesValidator(ids, translate('input.validator.uniqueid.error'));

export function NoWhiteSpaceValidator(errorMessage) {
  function validator(value) {
    // if the string contains whitespace
    if(/\s/.test(value)) {
      return errorMessage;
    }
  }

  return validator;
}

export function YamlValidator(text) {
  try {
    safeLoad(text);
  } catch (e) {
    return translate('input.validator.yaml.error');
  }
}

export function NetmaskValidator(netmask) {
  if (NETMASK.exec(netmask) === null) {
    return translate('input.validator.netmask.error');
  }
}

// return a validator that will validate an IP in in the netmask's subnet
export function IpInNetmaskValidator(netmask) {
  function validator(ip) {
    const ipInt = ipAddrToInt(ip);
    const netmaskInt = ipAddrToInt(netmask);
    if(((ipInt & netmaskInt) >>> 0) !== ipInt) {
      return translate('input.validator.netmask.ipinvalid.error');
    }
  }

  return validator;
}

// Return a validator that requires the entered value to
// NOT be in the given list or set.
//
// Note that the counterpart to this validator, createIncludesValidator,
// is generally unnecessary, since a pulldown list would normally
// be used in the situation where there is a fixed set of valid inputs.
export function createExcludesValidator(values, errorMsg) {

  console.assert(values !== undefined,                  // eslint-disable-line no-console
    'Error: createExcludesValidator called without values');

  function validator(value) {

    if (values === undefined)
      return;

    let exists;
    // Use the value of the has() function if such a function is present, otherwise use the
    // exists() function if present. Immutable lists are the exception as they possess both has()
    // and includes(), and they should use the latter.
    //
    // Note that while this is slightly wordier than than compact construct:
    //    values.has?(value) || value?.includes(value)
    // this construct was not used since some types (particularly immutable Maps) have both a
    // 'has' (for checking keys) and an 'includes' (for checking values), and we only want to use
    // the has; i.e. we don't want to search through the values if the keys are known not to contain
    // the value.
    if (values.has && ! List.isList(values)) {
      exists = values.has(value);
    } else if (values.includes) {
      exists = values.includes(value);
    }

    if (exists) {
      return errorMsg || translate('duplicate.error', value);
    }
  }

  return validator;
}

// Return a single validator function that in turn invokes multiple validators, and
// returning the result if any fail.
// This permits checking against multiple criteria simply; without this, checking
// against multiple criteria requires either creating a single function that has multiple
// ways of using it (depending on which criteria are to be enforced), or it requires
// a writing a combinatorial number of functions depending on the criteria
export function chainValidators(...validators) {

  function chained(value) {
    for (let validator of validators) {
      const result = validator(value);
      if (result) {
        return result;
      }
    }
  }

  return chained;
}
