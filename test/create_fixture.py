#!/usr/bin/env python

from pprint import pprint

import numpy as np

from datetime import datetime

from beyond.dates import Date, timedelta
from beyond.io.tle import Tle
from beyond.frames import create_station, orient
from beyond.frames.frames import ITRF
from beyond.config import config
from beyond.orbits.statevector import StateVector
from beyond.propagators.listeners import RadialVelocityListener

start_time = Date(datetime.fromisoformat('2021-10-30T09:54:34'))
tle = Tle("""MCUBED-2
1 39469U 13072H   21302.39443530 +.00002769 +00000+0 +23233-3 0  1556
2 39469 120.4902 222.1891 0257271  50.3110 312.0449 14.80089887 26464""").orbit()
station = create_station('HSGR', (38.017, 23.731, 104.0))


def geodeticToEcf_fixture():
    sv = StateVector(coord=[0,0,0,0,0,0], date=start_time, form="cartesian", frame=station)
    print(np.array(sv.copy(frame="ITRF"))[:3] * 1e-3)

# geodeticToEcf_fixture()

def propagate_fixture():
    sv = tle.propagate(start_time)
    result = {'position': {
                 'x': sv.x * 1e-3,
                 'y': sv.y * 1e-3,
                 'z': sv.z * 1e-3,
              },
              'velocity': {
                 'x': sv.vx * 1e-3,
                 'y': sv.vy * 1e-3,
                 'z': sv.vz * 1e-3,
              }}
    pprint(result)

# propagate_fixture()


def doppler_fixture():
    sv = tle.propagate(start_time)
    c = 299792458; # Speed of light in m/s
    print(RadialVelocityListener(station)(sv) / c * 1e5)

doppler_fixture()
