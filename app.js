'use strict';

const Homey = require('homey');

class Pax extends Homey.App {

  static DEFAULT_BOOST_DURATION = 900;

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.registerFlowListeners();
    this.log('PAX has been initialized');
  }

  registerFlowListeners() {
    // action cards
    const boostOff = this.homey.flow.getActionCard('boost_off');
    boostOff.registerRunListener(async (args, state) => args.device.boostOnOff(
      {
        on: false,
      },
    ));

    const boostOn = this.homey.flow.getActionCard('boost_on');
    boostOn.registerRunListener(async (args, state) => {
      args.device.boostOnOff(
        {
          on: true,
          duration: typeof args.duration === 'number' && args.duration % 25 === 0
            ? args.duration / 1000 // given in MS
            : this.constructor.DEFAULT_BOOST_DURATION,
        },
      );
    });
  }

}

module.exports = Pax;
