'use strict';

import Homey, { FlowCardAction } from 'homey';

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
      return args.device.boostOnOff({ on: false });
    });

    const boostOn: FlowCardAction = this.homey.flow.getActionCard('boost_on');
    boostOn.registerRunListener(async (args: any) => {
      return args.device.boostOnOff({
        on: true,
        duration: typeof args.duration === 'number' && args.duration % 25 === 0
          ? args.duration / 1000 // given in MS
          : Pax.DEFAULT_BOOST_DURATION,
      });
    });

    // condition cards
    const modeEquals: FlowCardAction = this.homey.flow.getConditionCard('mode_equals');
    modeEquals.registerRunListener(async (args: any) => {
      return args.device.getCapabilityValue('mode') === args.mode;
    });

    const boostOnCondition: FlowCardAction = this.homey.flow.getConditionCard('boost_on');
    boostOnCondition.registerRunListener(async (args: any) => {
      return args.device ? args.device.getCapabilityValue('boost') : false;
    });
  }

}

module.exports = Pax;
