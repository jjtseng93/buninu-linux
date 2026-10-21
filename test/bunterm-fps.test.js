import {test,expect} from 'bun:test';
import {createFpsMeter} from '../initramfs/lib/bunterm/fps.js';
test('FPS counts new image presentations, ignores redraws, idles at zero and resets on toggle',()=>{
 let time=0;const meter=createFpsMeter(()=>time),old={},a={},b={};
 meter.presented([{image:old}]);expect(meter.enabled).toBe(false);
 expect(meter.toggle([{image:old}])).toBe(true);
 meter.presented([{image:old}]);
 meter.presented([{image:a}]);meter.presented([{image:a}]);
 meter.presented([{image:a},{image:b}]);meter.presented([]);
 time=1000;expect(meter.sample()).toBe(2);
 time=2000;expect(meter.sample()).toBe(0);
 expect(meter.toggle()).toBe(false);
 meter.presented([{image:{}}]);
 time=3000;expect(meter.sample()).toBe(0);
 meter.toggle([{image:b}]);meter.presented([{image:b}]);
 meter.presented([{image:{}}]);time=3500;expect(meter.sample()).toBe(2);
});
