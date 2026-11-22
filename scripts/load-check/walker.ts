// A random walk around the courtyard that the server's movement rules always accept
// (runtime design §5.4): a fixed step length below the speed limit, inside the courtyard.
import type { Vec3 } from '../../shared/contracts/index';

/** Walking speed in units per second; the courtyard limit is 4.8. */
export const WALK_SPEED = 4;
/** The walk stays inside this radius; the courtyard's is 23. */
export const WALK_RADIUS = 20;
/** Largest random change of heading per step, in radians. */
const MAX_TURN = 0.4;

export interface Walker {
  next(): { position: Vec3; rotation: number };
}

/**
 * Starts at `start` and moves `stepLength` per call. Rotation is the yaw of the step,
 * `atan2(dx, dz)`. When a step would leave WALK_RADIUS, the walker turns toward the centre.
 */
export function createWalker(start: Vec3, stepLength: number, random: () => number = Math.random): Walker {
  let x = start.x;
  let z = start.z;
  let heading = random() * 2 * Math.PI;

  return {
    next() {
      heading += (random() * 2 - 1) * MAX_TURN;
      if (Math.hypot(x + Math.sin(heading) * stepLength, z + Math.cos(heading) * stepLength) > WALK_RADIUS) {
        heading = Math.atan2(-x, -z) + (random() * 2 - 1) * MAX_TURN;
      }
      x += Math.sin(heading) * stepLength;
      z += Math.cos(heading) * stepLength;
      const rotation = Math.atan2(Math.sin(heading), Math.cos(heading));
      return { position: { x, y: 0, z }, rotation };
    },
  };
}
