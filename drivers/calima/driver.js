'use strict';

const Homey = require('homey');
const serviceIds = require('../../lib/serviceIds');
const PaxApi = require('../../lib/api');

class PaxCalimaDriver extends Homey.Driver {

  static DISCOVER_INTERVAL = 1000 * 60 * 1; // 1 minute

  async onInit() {
    this.advertisements = {};
    this.deviceProperties = {};
    this.onDiscover = this.onDiscover.bind(this);
    this.onDiscoverInterval = setInterval(this.onDiscover, this.constructor.DISCOVER_INTERVAL);
    this.onDiscover();
    this.log('Pax Calima driver has been initiated');
  }

  async onDiscover() {
    this.log('Discovering...');

    const alreadyAdded = this.getDevices().map((device) => {
      const { id } = device.getData();
      return id;
    });

    const advertisements = await this.homey.ble.discover([serviceIds.DISCOVERY_SERVICE_UUID]).catch(this.error);

    const filteredAdvertisements = advertisements
      .filter((a) => a.address.startsWith('58:2B:DB')) // filter PAX Calima address
      .filter((a) => !alreadyAdded.includes(a.uuid)) // filter already added
      .filter((a) => !this.advertisements[a.address]); // filter already found

    this.homey.log(`Found ${filteredAdvertisements.length} device(s) that haven't been added: ${filteredAdvertisements.map((a) => `${a.address} (${a.localName})`).join(', ')}`);

    const promises = filteredAdvertisements.map(async (advertisement) => {
      try {
        const { address } = advertisement;

        const peripheral = await advertisement.connect();
        await peripheral.assertConnected();
        await peripheral.discoverAllServicesAndCharacteristics();

        const api = new PaxApi(null, peripheral, this.homey);
        const { name, mode } = await api.getNameAndMode();
        this.log(`New device ready. Address: ${address}, Name: ${name}, Mode: ${mode}`);
        this.deviceProperties[address] = { name, mode };
        this.advertisements[address] = advertisement;
        peripheral.disconnect();
        return { success: true };
      } catch (error) {
        this.homey.error(error);
        return { success: false, error };
      }
    });

    await Promise.all(promises);
  }

  // Pairing
  async onPair(session) {
    session.setHandler('list_devices', async () => {
      return Promise.all(Object.values(this.advertisements).map((advertisement) => {
        const device = {
          name: this.deviceProperties[advertisement.address].name,
          data: {
            id: advertisement.uuid,
            address: advertisement.address,
            pin: '',
          },
          store: {
            peripheralUuid: advertisement.uuid,
            mode: this.deviceProperties[advertisement.address].mode,
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
