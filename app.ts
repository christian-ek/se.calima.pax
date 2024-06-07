'use strict';

import Homey, { FlowCardAction, FlowCardCondition } from 'homey';

class Pax extends Homey.App {
  static DEFAULT_BOOST_DURATION: number = 900;

  /**
   * onInit is called when the app is initialized.
   */
  async onInit(): Promise<void> {
    this.registerFlowListeners();
    this.log('PAX has been initialized');
  }

  registerFlowListeners(): void {
    // action cards
    const boostOff: FlowCardAction = this.homey.flow.getActionCard('boost_off');
    boostOff.registerRunListener(async (args: any) => {
      this.homey.log('boostOff action triggered');
      if (!args.device) {
        this.homey.error('Device is not defined');
        throw new Error('Device is not defined');
      }
      await args.device.boostOnOff({ on: false });
      this.homey.log('boostOff action executed successfully');
      return Promise.resolve(true);
    });

    const boostOn: FlowCardAction = this.homey.flow.getActionCard('boost_on');
    boostOn.registerRunListener(async (args: any) => {
      this.homey.log('boostOn action triggered');
      if (!args.device) {
        this.homey.error('Device is not defined');
        throw new Error('Device is not defined');
      }
      const duration = typeof args.duration === 'number' && args.duration % 25 === 0
        ? args.duration / 1000 // given in MS
        : Pax.DEFAULT_BOOST_DURATION;

      try {
        this.homey.log(`Calling boostOnOff with duration: ${duration}`);
        await args.device.boostOnOff({
          on: true,
          duration,
        });
        this.homey.log(`boostOn action executed successfully with duration: ${duration}`);
      } catch (error) {
        this.homey.error('Error executing boostOn action');
        throw error;
      }

      return Promise.resolve(true);
    });

    // condition cards
    const modeEquals: FlowCardCondition = this.homey.flow.getConditionCard('mode_equals');
    modeEquals.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('mode') === args.mode;
    });

    const boostOnCondition: FlowCardCondition = this.homey.flow.getConditionCard('boost_on');
    boostOnCondition.registerRunListener(async (args: any) => {
      return args.device ? args.device.getCapabilityValue('boost') : false;
    });

    // Additional condition cards for above values
    const temperatureAbove: FlowCardCondition = this.homey.flow.getConditionCard('temperature_above');
    temperatureAbove.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('measure_temperature') > args.temperature;
    });

    const humidityAbove: FlowCardCondition = this.homey.flow.getConditionCard('humidity_above');
    humidityAbove.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('measure_humidity') > args.humidity;
    });

    const luminanceAbove: FlowCardCondition = this.homey.flow.getConditionCard('luminance_above');
    luminanceAbove.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('measure_luminance') > args.luminance;
    });

    const rpmAbove: FlowCardCondition = this.homey.flow.getConditionCard('rpm_above');
    rpmAbove.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('measure_rpm') > args.rpm;
    });

    const trickleSpeedAbove: FlowCardCondition = this.homey.flow.getConditionCard('trickle_speed_above');
    trickleSpeedAbove.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('fanspeed.trickle') > args.speed;
    });

    const humiditySpeedAbove: FlowCardCondition = this.homey.flow.getConditionCard('humidity_speed_above');
    humiditySpeedAbove.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('fanspeed.humidity') > args.speed;
    });

    const lightSpeedAbove: FlowCardCondition = this.homey.flow.getConditionCard('light_speed_above');
    lightSpeedAbove.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('fanspeed.light') > args.speed;
    });

    // Additional condition cards for below values
    const temperatureBelow: FlowCardCondition = this.homey.flow.getConditionCard('temperature_below');
    temperatureBelow.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('measure_temperature') < args.temperature;
    });

    const humidityBelow: FlowCardCondition = this.homey.flow.getConditionCard('humidity_below');
    humidityBelow.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('measure_humidity') < args.humidity;
    });

    const luminanceBelow: FlowCardCondition = this.homey.flow.getConditionCard('luminance_below');
    luminanceBelow.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('measure_luminance') < args.luminance;
    });

    const rpmBelow: FlowCardCondition = this.homey.flow.getConditionCard('rpm_below');
    rpmBelow.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('measure_rpm') < args.rpm;
    });

    const trickleSpeedBelow: FlowCardCondition = this.homey.flow.getConditionCard('trickle_speed_below');
    trickleSpeedBelow.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('fanspeed.trickle') < args.speed;
    });

    const humiditySpeedBelow: FlowCardCondition = this.homey.flow.getConditionCard('humidity_speed_below');
    humiditySpeedBelow.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('fanspeed.humidity') < args.speed;
    });

    const lightSpeedBelow: FlowCardCondition = this.homey.flow.getConditionCard('light_speed_below');
    lightSpeedBelow.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('fanspeed.light') < args.speed;
    });
  }
}

module.exports = Pax;
