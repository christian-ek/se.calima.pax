'use strict';

const Homey = require('homey');
const serviceIds = require('../../lib/serviceIds');
const PaxApi = require('../../lib/api');

class PaxCalimaDriver extends Homey.Driver {

  static DISCOVER_INTERVAL = 1000 * 60 * 1; // 1 minute

  async onInit() {
    this.advertisements = {};
    this.onDiscover = this.onDiscover.bind(this);
    this.onDiscoverInterval = setInterval(this.onDiscover, this.constructor.DISCOVER_INTERVAL);
    await this.onDiscover();
    this.names = {};
    this.modes = {};
    this.log('Pax Calima driver has been initiated');
  }

  async onDiscover() {
    this.log('Discovering...');
    const alreadyAdded = this.getDevices().map((device) => {
      const { id } = device.getData();
      return id;
    });

    const advertisements = await this.homey.ble.discover([serviceIds.DISCOVERY_SERVICE_UUID]).catch(this.error);

    this.homey.log(`All discovered devices: ${advertisements.map((device) => {
      return `${device.address} (${device.localName})`;
    }).join(', ')}`);

    advertisements
      .filter((a) => a.address.startsWith('58:2B:DB')) // filter PAX Calima address
      .filter((a) => !alreadyAdded.includes(a.uuid)) // filter already added
      .filter((a) => !this.advertisements[a.address]) // filter already found
      .forEach(async (advertisement) => {
        this.homey.log(`Found device that hasn't been added [${advertisement.address}] Looking up name and mode...`);
        const api = new PaxApi(null, advertisement, this.homey);
        api.getNameAndMode()
          .then((value) => {
            this.log(`Done looking up device.. Address: ${advertisement.address} - Name: ${value.name} - Mode: ${value.mode}`);
            this.names[advertisement.address] = value.name;
            this.modes[advertisement.address] = value.mode;
            this.advertisements[advertisement.address] = advertisement;
          })
          .catch(this.error);
      });
  }

  // Pairing
  async onPair(session) {
    session.setHandler('list_devices', async () => {
      return Promise.all(Object.entries(this.advertisements).map(async ([name, advertisement]) => {
        const device = {
          name: this.names[advertisement.address],
          data: {
            id: advertisement.uuid,
            address: advertisement.address,
            pin: '',
          },
          store: {
            peripheralUuid: advertisement.uuid,
            mode: this.modes[advertisement.address],
            firstRun: true,
          },
        };

        return device;
      }));
    });

    session.setHandler('list_devices_selection', async (data) => {
      this.homey.app.log(`[Driver] ${this.id} - selected_device - `, data[0].name);
      this.device = data[0];
    });

    session.setHandler('pincode', async (pincode) => {
      // The pincode is given as an array of the filled in values
      this.device.data.pin = pincode.join('');

      return this.device;
    });

    session.setHandler('done', async (data) => {
      const deviceAddress = this.device.data.address;
      delete this.advertisements[deviceAddress];
      return this.device;
    });
  }

}

module.exports = PaxCalimaDriver;
