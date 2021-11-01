import assert from 'assert';
import {relativeRangeRate, DopplerModel, date2ModifiedJulianDate} from '../lib/dopplerFactor.js';
import { Spectroplot, loadUrl } from '../lib/spectroplot.js';
import * as satellite from 'satellite.js';

// https://network-dev.satnogs.org/observations/31938/
let TLE = 'MCUBED-2\n1 39469U 13072H   21302.39443530 +.00002769 +00000+0 +23233-3 0  1556\n2 39469 120.4902 222.1891 0257271  50.3110 312.0449 14.80089887 26464\n';
let LOCATION = {'latitude': 38.017, 'longitude': 23.731, 'altitude': 104};
let FREQUENCY = 437480000;
let START_TIME = '2021-10-30T09:54:34.787721Z';

describe('DopplerModel', function() {
  describe('getDopplerFactor', function() {
    it('return the correct doppler factor for a certain pass over a certain station', function() {
      let doppler_model = new DopplerModel(TLE.split("\n").slice(1, 3),
                                           {longitude: LOCATION.longitude,
                                            latitude: LOCATION.latitude,
                                            height: LOCATION.altitude/1000},
                                           START_TIME);

      let start_time = new Date(START_TIME);
      let beta = doppler_model.getDopplerFactor(start_time);
      console.log(beta * 1e5);
      // Result:
      // -1.8701335463170967

      // Expected (from beyond):
      // -1.8779412638740038
    });
  });

  describe('satellite.js geodeticToEcf method', function() {
      let observerEcef = satellite.geodeticToEcf({
          latitude: satellite.degreesToRadians(LOCATION.latitude),
          longitude: satellite.degreesToRadians(LOCATION.longitude),
          height: LOCATION.altitude / 1000,
      });

      console.log(observerEcef);
      // Result:
      // {x: 4605.923498338159,
      //  y: 2024.8320122623202,
      //  z: 3906.9947803617115}

      // expected ("beyond"):
      // {x: 4594.25145174,
      //  y: 2019.70080815,
      //  z: 3923.35793693}
  });

  describe('satellite.js propagate method', function() {
        let tle = TLE.split("\n");
        let t = new Date(START_TIME);
        let satrec = satellite.twoline2satrec(tle[1], tle[2]);
        let sv = satellite.propagate(satrec, t);

        console.log(sv);
        // Result:
        // {position: {x: -5370.501921861612,
        //             y: -3127.6598992560093,
        //             z: 2851.005865115369},
        //  velocity: {x: 0.2046171663457279,
        //             y: 5.110240628722257,
        //             z: 5.794424191108914}}

        // expected ("beyond"):
        // {'position': {'x': -5370.6648820211685,
        //               'y': -3131.7031313860293,
        //               'z': 2846.3967240034594},
        //  'velocity': {'x': 0.19931947869139408,
        //               'y': 5.107152682165725,
        //               'z': 5.797257567932312}}
  });
});
