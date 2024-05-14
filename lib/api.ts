import struct from 'python-struct';
import Homey, { BlePeripheral } from 'homey';
import { characteristics, serviceIds } from './consts';
import FanState from './FanState';
import BoostMode from './BoostMode';
import FanSpeed from './FanSpeed';
import FanMode from './FanMode';

class PaxApi extends Homey.SimpleClass {

  private pin: string | null;
  private peripheral: BlePeripheral;
  private homey: any;

  constructor(pin: string | null, peripheral: BlePeripheral, homey: any) {
    super();
    this.pin = pin;
    this.peripheral = peripheral;
    this.homey = homey;
  }

  async auth(pin: string): Promise<void> {
    try {
      await this.peripheral.write(
        serviceIds.PIN_SERVICE_UUID,
        characteristics.PIN_CODE,
        struct.pack('<I', parseInt(pin, 10)),
      );
    } catch (error) {
      throw new Error(`Unable to write PIN to peripheral: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    try {
      const isConnected = await this.peripheral.assertConnected();
      if (isConnected) {
        await this.peripheral.disconnect();
      } else {
        this.homey.log('Peripheral is already disconnected.');
      }
    } catch (error) {
      this.homey.error(`Unable to disconnect from peripheral: ${error}`);
    }
  }

  checkConnection(): boolean {
    try {
      if (!this.peripheral.assertConnected()) {
        this.homey.error(`[${this.getName()}]`, 'Peripheral not found or not connected.');
        return false;
      }
      return true;
    } catch (error) {
      this.homey.error(`Error checking connection: ${error}`);
      return false;
    }
  }

  async getNameAndMode(): Promise<{ name: string; mode: string | undefined }> {
    return {
      name: await this.getName(),
      mode: await this.getMode(),
    };
  }

  async getName(): Promise<string> {
    try {
      const data = await this.peripheral.read(serviceIds.PIN_SERVICE_UUID, characteristics.FAN_DESCRIPTION);
      const name = data.toString();
      this.homey.log(`Got device name: ${name}`);
      return name;
    } catch (error) {
      throw new Error(`Unable to read peripheral: ${error}`);
    }
  }

  async getMode(): Promise<string | undefined> {
    try {
      const data = await this.peripheral.read(serviceIds.BOOST, characteristics.MODE);
      const unpackedData = struct.unpack('<B', data);
      const modeIndex = unpackedData[0] as number;
      return FanMode.getModeByIndex(modeIndex);
    } catch (error) {
      throw new Error(`Unable to read peripheral: ${error}`);
    }
  }

  async getStatus(): Promise<FanState> {
    try {
      const data = await this.peripheral.read(serviceIds.STATUS_SERVICE_UUID, characteristics.SENSOR_DATA);
      const v = struct.unpack('<4HBHB', data);

      // Ensure the unpacked values are treated as numbers.
      const v0 = Number(v[0]);
      const v1 = Number(v[1]);
      const v2 = Number(v[2]);
      const v3 = Number(v[3]);
      const v4 = Number(v[4]);

      let trigger = 'No trigger';
      if (((v4 >> 4) & 1) === 1) {
        trigger = 'Boost';
      } else if ((v4 & 3) === 1) {
        trigger = 'Trickle ventilation';
      } else if ((v4 & 3) === 2) {
        trigger = 'Light ventilation';
      } else if ((v4 & 3) === 3) {
        trigger = 'Humidity ventilation';
      }

      // Ensure all operations are with numbers
      const rpm = v0 > 0 ? Math.round(Math.log2(v0) * 10) : 0;
      const temperature = v1 / 4;

      return new FanState(rpm, temperature, v2, v3, trigger);
    } catch (error) {
      throw new Error(`Unable to read peripheral: ${error}`);
    }
  }

  async getFanSpeed(): Promise<FanSpeed> {
    try {
      const data = await this.peripheral.read(serviceIds.BOOST, characteristics.LEVEL_OF_FAN_SPEED);
      const unpackedData = struct.unpack('<HHH', data);

      // Assert that each unpacked value is a number.
      const humidity = unpackedData[0] as number;
      const light = unpackedData[1] as number;
      const trickle = unpackedData[2] as number;

      return new FanSpeed(humidity, light, trickle);
    } catch (error) {
      throw new Error(`Unable to read peripheral: ${error}`);
    }
  }

  async setFanSpeed(humidity: number = 2250, light: number = 1625, trickle: number = 1000): Promise<void> {
    const values = [humidity, light, trickle];
    for (const val of values) {
      if (val % 25 !== 0) {
        throw new Error('Speeds should be multiples of 25');
      }
      if (val > 2500 || val < 0) {
        throw new Error('Speeds must be between 0 and 2500 rpm');
      }
    }

    if (this.pin === null) {
      throw new Error('PIN is required to set fan speed');
    }

    try {
      await this.auth(this.pin);
      await this.peripheral.write(
        serviceIds.BOOST,
        characteristics.LEVEL_OF_FAN_SPEED,
        struct.pack('<HHH', humidity, light, trickle),
      );
    } catch (error) {
      throw new Error(`Unable to set boost mode: ${error}`);
    }
  }

  async getBoostMode(): Promise<BoostMode> {
    try {
      const data = await this.peripheral.read(serviceIds.BOOST, characteristics.BOOST);
      const unpackedData = struct.unpack('<BHH', data);

      const mode = unpackedData[0] !== 0; // Convert to boolean
      const speed = unpackedData[1] as number;
      const duration = unpackedData[2] as number;

      return new BoostMode(mode, speed, duration);
    } catch (error) {
      throw new Error(`Unable to read peripheral: ${error}`);
    }
  }

  startBoost(duration: number): Promise<void> {
    return this.setBoostMode(1, 2250, duration);
  }

  stopBoost(): Promise<void> {
    return this.setBoostMode(0, 0, 0);
  }

  async setBoostMode(on: number, speed: number, seconds: number): Promise<void> {
    if (speed % 25 !== 0) {
      throw new Error('Speed must be a multiple of 25');
    }

    if (this.pin === null) {
      throw new Error('PIN is required to set fan speed');
    }

    try {
      await this.auth(this.pin);
      await this.peripheral.write(serviceIds.BOOST, characteristics.BOOST, struct.pack('<BHH', on, speed, seconds));
    } catch (error) {
      throw new Error(`Unable to set boost mode: ${error}`);
    }
  }
}

export default PaxApi;
