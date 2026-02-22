import { describe, it, expect } from 'vitest';
import { MyObject } from '../src/electron/bindings';

describe('Native C++ Addon', () => {
  it('should load the addon successfully', () => {
    const myObject = new MyObject('Test');
    expect(myObject).toBeDefined();
  });

  it('should return the correct string from greet', () => {
    const myObject = new MyObject('Test');
    const result = myObject.greet('World');
    expect(result).toBe('Hello World, my name is Test');
  });

  it('should return the correct sum from add', () => {
    const myObject = new MyObject('Test');
    const result = myObject.add(5, 7);
    expect(result).toBe(12);
  });
});
