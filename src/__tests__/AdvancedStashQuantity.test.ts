import {
  TextDecoder as NodeTextDecoder,
  TextEncoder as NodeTextEncoder,
} from 'util';
import type {
  IConfig,
  IConstantData,
  IItem,
} from '../bridge/third-party/d2s/d2/types.d';
import { BitReader } from '../main/worker/third-party/d2s/binary/bitreader';
import {
  readItem,
  readItems,
  writeItem,
  writeItems,
} from '../main/worker/third-party/d2s/d2/items';

Object.defineProperties(globalThis, {
  TextDecoder: { configurable: true, value: NodeTextDecoder },
  TextEncoder: { configurable: true, value: NodeTextEncoder },
});

const SAVE_VERSION = 0x69;
const REALM = 0;

const constants: IConstantData = {
  armor_items: {},
  classes: [],
  magic_prefixes: [],
  magic_suffixes: [],
  magical_properties: [],
  other_items: { abcd: { c: [] } },
  properties: {},
  rare_names: [],
  runewords: [],
  set_items: [],
  skills: [],
  stackables: {},
  unq_items: [],
  waypoint_acts: [],
  weapon_items: {},
};
const config: IConfig = {};

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function simpleItem(
  hasAdvancedStashQuantity: boolean,
  advancedStashQuantity: number,
): IItem {
  return {
    _unknown_data: {},
    alt_position_id: 0,
    categories: [],
    equipped_id: 0,
    ethereal: 0,
    given_runeword: 0,
    has_advanced_stash_quantity: hasAdvancedStashQuantity,
    has_chronicle_data: false,
    identified: 0,
    is_ear: 0,
    location_id: 0,
    new: 0,
    nr_of_items_in_sockets: 0,
    personalized: 0,
    position_x: 0,
    position_y: 0,
    simple_item: 1,
    socketed: 0,
    starter_item: 0,
    type: 'abcd',
    version: '101',
    advanced_stash_quantity: advancedStashQuantity,
  } as unknown as IItem;
}

async function roundTrip(item: IItem): Promise<IItem> {
  const encoded = await writeItem(item, SAVE_VERSION, REALM, constants, config);
  const reader = new BitReader(exactBuffer(encoded));
  const decoded = await readItem(
    reader,
    SAVE_VERSION,
    REALM,
    constants,
    config,
  );
  expect(reader.offset).toBe(encoded.byteLength * 8);
  return decoded;
}

describe('advanced stash quantity framing', () => {
  it.each([
    { hasQuantity: false, quantity: 0 },
    { hasQuantity: false, quantity: 1 },
    { hasQuantity: false, quantity: 255 },
    { hasQuantity: true, quantity: 0 },
    { hasQuantity: true, quantity: 1 },
    { hasQuantity: true, quantity: 255 },
  ])(
    'round-trips has=$hasQuantity and quantity=$quantity',
    async ({ hasQuantity, quantity }) => {
      const decoded = await roundTrip(simpleItem(hasQuantity, quantity));

      expect(decoded.has_advanced_stash_quantity).toBe(hasQuantity);
      expect(decoded.advanced_stash_quantity).toBe(
        hasQuantity ? quantity : undefined,
      );
    },
  );

  it('emits identical frames when the flag is false regardless of quantity', async () => {
    const encodings = await Promise.all(
      [0, 1, 255].map((quantity) =>
        writeItem(
          simpleItem(false, quantity),
          SAVE_VERSION,
          REALM,
          constants,
          config,
        ),
      ),
    );

    expect(encodings[1]).toEqual(encodings[0]);
    expect(encodings[2]).toEqual(encodings[0]);
  });

  it('keeps consecutive items byte-aligned at their encoded offsets', async () => {
    const first = simpleItem(true, 0);
    const second = simpleItem(true, 255);
    const firstFrame = await writeItem(
      first,
      SAVE_VERSION,
      REALM,
      constants,
      config,
    );
    const encoded = await writeItems(
      [first, second],
      SAVE_VERSION,
      REALM,
      constants,
      config,
    );
    const reader = new BitReader(exactBuffer(encoded));

    const decoded = await readItems(
      reader,
      SAVE_VERSION,
      REALM,
      constants,
      config,
    );

    expect(decoded).toHaveLength(2);
    expect(decoded[0].offset).toBe(32);
    expect(decoded[1].offset).toBe(32 + firstFrame.byteLength * 8);
    expect(decoded[0].has_advanced_stash_quantity).toBe(true);
    expect(decoded[0].advanced_stash_quantity).toBe(0);
    expect(decoded[1].has_advanced_stash_quantity).toBe(true);
    expect(decoded[1].advanced_stash_quantity).toBe(255);
    expect(reader.offset).toBe(encoded.byteLength * 8);
  });
});
