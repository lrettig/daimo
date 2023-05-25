import { Account, parse, serialize } from "../src/logic/account";

describe("Account", () => {
  it("serializes", () => {
    const a: Account = {
      address: "0x123",
      lastBalance: BigInt(123),
      lastNonce: BigInt(456),
      lastBlockTimestamp: 789,
    };
    const ser = serialize(a);
    expect(ser).toEqual(
      '{"storageVersion":1,"address":"0x123","lastBalance":"123","lastNonce":"456","lastBlockTimestamp":789}'
    );
  });

  it("deserializes", () => {
    const ser =
      '{"storageVersion":1,"address":"0x123","lastBalance":"123","lastNonce":"456","lastBlockTimestamp":789}';
    const a = parse(ser);
    expect(a).toEqual({
      address: "0x123",
      lastBalance: BigInt(123),
      lastNonce: BigInt(456),
      lastBlockTimestamp: 789,
    });
  });
});