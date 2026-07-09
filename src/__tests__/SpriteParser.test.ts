import { parseSprite } from '../main/worker/SpriteParser';

describe('SpriteParser', () => {
  it('reads sprite headers relative to a sliced Buffer', () => {
    const backing = Buffer.alloc(0x28 + 4 + 7, 0xff);
    const sprite = backing.subarray(7);
    sprite.writeUInt16LE(31, 0x4);
    sprite.writeInt32LE(1, 0x8);
    sprite.writeInt32LE(1, 0xc);
    sprite.set([255, 0, 0, 255], 0x28);

    expect(parseSprite(sprite)).toMatch(/^data:image\/png;base64,/);
  });
});
