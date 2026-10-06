// Demo wallet of the statement example. $setOnInsert: running it again never
// resets a live balance or its version.
const now = new Date();
db.wallets.updateOne(
  { _id: 'usr_abc123' },
  {
    $setOnInsert: {
      currency: 'PEN',
      balanceMinor: NumberLong(25000),
      version: NumberInt(0),
      createdAt: now,
      updatedAt: now,
    },
  },
  { upsert: true },
);
