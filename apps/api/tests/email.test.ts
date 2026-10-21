import assert from "node:assert/strict";
import { test } from "node:test";

import { EmailAddressSchema } from "#auth/email";

const addresses = [
  ["First.Last+review@GoogleMail.com", "firstlast@gmail.com"],
  ["firstlast@gmail.com", "firstlast@gmail.com"],
  ["Nickname-review@yahoo.com", "nickname@yahoo.com"],
  ["Nickname-other@yahoo.com", "nickname@yahoo.com"],
  ["base-name-review@ymail.com", "base-name@ymail.com"],
  ["Name+review@outlook.com", "name@outlook.com"],
  ["Name+review@hotmail.co.uk", "name@hotmail.co.uk"],
  ["Name+review@icloud.com", "name@icloud.com"],
  ["Name+review@me.com", "name@me.com"],
  ["Name@ya.ru", "name@yandex.ru"],
  ["First.Last+review@hospital.cz", "first.last+review@hospital.cz"],
  ["First.Last-review@hospital.cz", "first.last-review@hospital.cz"],
  ["First.Last@yahoo.com", "first.last@yahoo.com"],
];

await Promise.all(
  addresses.map(async ([input, canonical]) =>
    test(`email identity: ${String(input)}`, () => {
      assert.ok(input !== undefined);
      assert.deepEqual(EmailAddressSchema.parse(input), { canonical, display: input });
    }),
  ),
);

await test("rejects invalid addresses and empty normalized mailboxes", () => {
  for (const address of [
    "",
    "not-an-email",
    " name@gmail.com",
    "name@gmail.com ",
    "name@@gmail.com",
    "+tag@gmail.com",
    "-tag@yahoo.com",
    "a..b@gmail.com",
  ]) {
    assert.equal(EmailAddressSchema.safeParse(address).success, false);
  }
});
