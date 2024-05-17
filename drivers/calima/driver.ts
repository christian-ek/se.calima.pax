import Homey, {
  BleAdvertisement, BlePeripheral, FlowCardAction,
} from 'homey';
import PaxApi from '../../lib/api';

class PaxCalimaDriver extends Homey.Driver {

  private advertisements: Record<string, BleAdvertisement> = {};
  private deviceProperties: Record<string, { name: string; mode: string }> = {};
  private device: any;

  async onInit(): Promise<void> {
    this.log('Pax Calima driver has been initiated');
    // Register action flow cards
    const trickleFanSpeedAction: FlowCardAction = this.homey.flow.getActionCard('fanspeed');
    trickleFanSpeedAction.registerRunListener(async (args) => {
      await args.device.onCapabilitySetFanSpeed(args.speed, 'trickle');
      return true;
    });
  }

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    session.setHandler('list_devices', async () => {
      await this.onDiscover(); // Trigger discovery on demand during pairing
      return Object.values(this.advertisements).map((advertisement) => ({
        name: this.deviceProperties[advertisement.address.toUpperCase()].name,
        data: {
          id: advertisement.uuid,
          address: advertisement.address.toUpperCase(),
        },
        store: {
          peripheralUuid: advertisement.uuid,
          mode: this.deviceProperties[advertisement.address.toUpperCase()].mode,
          firstRun: true,
        },
      }));
    });

    session.setHandler('list_devices_selection', async (data) => {
      this.log(`[Driver] - Selected device: ${data[0].name}`);
      this.device = data[0];
    });

    session.setHandler('pincode', async (pincode: string[]) => {
      // Assuming pin code handling and device data storing
      this.device.data.pin = pincode.join('');

      return this.device;
    });

    session.setHandler('done', async () => {
      const deviceAddress = this.device.data.address;
      delete this.advertisements[deviceAddress.toUpperCase()];
      return this.device;
    });
  }

  async onDiscover(): Promise<void> {
    this.log('Running discovery...');

    const alreadyAdded = this.getDevices().map((device) => device.getData().id);

    const advertisements: BleAdvertisement[] = await this.homey.ble.discover().catch((error: Error) => {
      this.homey.error(error.message);
      return [];
    });

    if (!advertisements.length) {
      this.log('No advertisements found during discovery.');
      return;
    }

    const filteredAdvertisements = advertisements.filter(
      (advertisement) => advertisement.address.toUpperCase().startsWith('58:2B:DB')
        && !alreadyAdded.includes(advertisement.uuid)
        && !this.advertisements[advertisement.address.toUpperCase()],
    );

    this.log(
      `[Discovery PAX] Found ${filteredAdvertisements.length} device(s) that haven't been added: ${filteredAdvertisements.map((a) => `${a.address.toUpperCase()} (${a.localName})`).join(', ')}`,
    );

    const promises = filteredAdvertisements.map(async (advertisement) => {
      try {
        const peripheral: BlePeripheral = await advertisement.connect();
        await peripheral.assertConnected();
        await peripheral.discoverAllServicesAndCharacteristics();

        const api = new PaxApi(null, peripheral, this.homey);
        const { name, mode } = await api.getNameAndMode();
        this.log(`New device ready. Address: ${advertisement.address.toUpperCase()}, Name: ${name}, Mode: ${mode}`);
        this.deviceProperties[advertisement.address.toUpperCase()] = { name, mode: mode || '' };
        this.advertisements[advertisement.address.toUpperCase()] = advertisement;
        await peripheral.disconnect();
        return { success: true };
      } catch (error) {
        if (error instanceof Error) {
          // Now TypeScript knows 'error' is an Error, we can log the message
          this.homey.error(error.message);
        } else {
          // If it's not an Error, we might still want to log something generic
          this.homey.error('An unknown error occurred during discovery');
        }
        return { success: false, error };
      }
    });

    await Promise.all(promises);
  }

}

module.exports = PaxCalimaDriver;
