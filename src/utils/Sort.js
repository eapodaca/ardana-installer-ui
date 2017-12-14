// (c) Copyright 2017 SUSE LLC
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
export function alphabetically(a,b) {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  return ((x < y) ? -1 : (x > y) ? 1 : 0);
}

export function byServerNameOrId(a,b) {
  return alphabetically(a['name'] || a['id'], b['name'] || b['id']);
}

