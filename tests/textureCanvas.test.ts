// Texture canvas helper tests - run with: npx tsx tests/textureCanvas.test.ts

import { mulberry32, rgb, rgba } from '../client/src/render/textureCanvas';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

console.log('texture canvas helpers');

{
  const a = mulberry32(123);
  const b = mulberry32(123);
  const c = mulberry32(124);
  const seqA = [a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b()];
  const seqC = [c(), c(), c(), c()];
  check('mulberry32 is deterministic for the same seed', JSON.stringify(seqA) === JSON.stringify(seqB));
  check('mulberry32 changes sequence for a different seed', JSON.stringify(seqA) !== JSON.stringify(seqC));
  check('mulberry32 values are normalized', seqA.every((v) => v >= 0 && v < 1), seqA.join(','));
}

{
  check('rgb rounds and clamps channels', rgb(12.2, -3, 300.6) === 'rgb(12,0,255)', rgb(12.2, -3, 300.6));
  check('rgba rounds channels and fixes alpha precision', rgba(1.2, 2.6, -1, 0.33333) === 'rgba(1,3,0,0.333)');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall texture canvas helper tests passed');
if (failures) process.exit(1);
