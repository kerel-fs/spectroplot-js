import * as satellite from 'satellite.js';

function relativeRangeRate(location, position, velocity) {
  // Source:
  // https://github.com/shashwatak/satellite-js/blob/1e6c4f0d14de5abab0d52b91a27b70028a0a0221/src/dopplerFactor.js
  // TODO: Refactor upstream to offer sign-aware range rate

  const mfactor = 7.292115E-5;
  const c = 299792.458; // Speed of light in km/s

  const range = {
    x: position.x - location.x,
    y: position.y - location.y,
    z: position.z - location.z,
  };
  range.w = Math.sqrt(range.x ** 2 + range.y ** 2 + range.z ** 2);

  const rangeVel = {
    x: velocity.x + mfactor * location.y,
    y: velocity.y - mfactor * location.x,
    z: velocity.z,
  };

  const rangeRate = (range.x * rangeVel.x + range.y * rangeVel.y + range.z * rangeVel.z) / range.w;

  return (rangeRate / c);
}

/*
 * Convert a js Date object to Julian date.
 * @param (Date) - Date
 * @returns {number} - Julian Date
 */
function date2ModifiedJulianDate(date) {
    return date.valueOf()/86400000 + 2440587.5 - 2400000.5;
}

class DopplerModel {
    /**
     * @param {[string, string]} tle - The TLE as a tuple of two lines
     * @param {{latitude: number, longitude: number, height: number}}  - The Observer location
     */
    constructor(tle, observer) {
        this.tle = tle;
        this.observer = observer;
    }

    getDopplerFactor(t) {
        /*
         * Calculate the Frequency as received by de-compensating the Doppler shift removed by re-tuning the station.
         *
         * Arguments:
         * t - Date
         */
        // Initialize Propagator
        let satrec = satellite.twoline2satrec(this.tle[0], this.tle[1]);
        let sv_eci = satellite.propagate(satrec, t);

        const observerEcf = satellite.geodeticToEcf({
            longitude: satellite.degreesToRadians(this.observer.longitude),
            latitude: satellite.degreesToRadians(this.observer.latitude),
            height: this.observer.height / 1000,
        });
        const gmst = satellite.gstime(t);
        const observerEci = satellite.ecfToEci(observerEcf, gmst);

        const beta = relativeRangeRate(observerEci, sv_eci.position, sv_eci.velocity);

        if (Number.isNaN(beta)) {
            console.log("ERROR: Propagator returned NaN value.");
        }
        return beta;
    }
}

export {relativeRangeRate, DopplerModel, date2ModifiedJulianDate};
