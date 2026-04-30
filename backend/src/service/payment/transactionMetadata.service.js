const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const mergeObjectField = (existingValue, nextValue) => {
  if (nextValue === undefined) {
    return existingValue ?? null;
  }

  if (nextValue === null) {
    return null;
  }

  if (isPlainObject(existingValue) && isPlainObject(nextValue)) {
    return {
      ...existingValue,
      ...nextValue,
    };
  }

  return nextValue;
};

export const createTransactionMetadata = ({
  existingMetadata = {},
  transak,
  tatum,
  success,
  extra = {},
} = {}) => {
  const baseMetadata = isPlainObject(existingMetadata) ? existingMetadata : {};

  return {
    ...baseMetadata,
    ...extra,
    transak: mergeObjectField(baseMetadata.transak, transak),
    tatum: mergeObjectField(baseMetadata.tatum, tatum),
    success: mergeObjectField(baseMetadata.success, success),
  };
};

export const buildFinalSuccessMetadata = ({
  transaction = {},
  status,
  transakMetadata = null,
  tatumMetadata = null,
  overrides = {},
  reconciledAt = new Date(),
} = {}) => {
  const normalizedTransak = isPlainObject(transakMetadata) ? transakMetadata : null;
  const normalizedTatum = isPlainObject(tatumMetadata) ? tatumMetadata : null;

  return {
    provider: transaction.provider || normalizedTransak?.provider || null,
    settlementProvider: normalizedTatum?.provider || null,
    type: transaction.type || null,
    status: status || transaction.status || null,
    currency:
      transaction.currency ||
      normalizedTransak?.cryptoCurrency ||
      normalizedTatum?.asset ||
      null,
    amount: transaction.amount ?? null,
    amountSun: transaction.amountSun ?? null,
    externalId:
      transaction.externalId ||
      normalizedTransak?.partnerOrderId ||
      normalizedTransak?.orderId ||
      null,
    providerOrderId: transaction.providerOrderId || normalizedTransak?.orderId || null,
    txId: transaction.txId || normalizedTatum?.txId || normalizedTransak?.txId || null,
    fromAddress:
      transaction.fromAddress ||
      normalizedTatum?.fromAddress ||
      normalizedTatum?.counterAddress ||
      null,
    toAddress:
      transaction.toAddress ||
      normalizedTatum?.toAddress ||
      normalizedTatum?.address ||
      normalizedTransak?.walletAddress ||
      null,
    flow: normalizedTransak?.flow || null,
    walletAddress: normalizedTransak?.walletAddress || normalizedTatum?.address || null,
    fiatAmount: normalizedTransak?.fiatAmount ?? null,
    fiatCurrency: normalizedTransak?.fiatCurrency || null,
    countryCode: normalizedTransak?.countryCode || null,
    chain: normalizedTatum?.chain || normalizedTatum?.network || null,
    asset: normalizedTatum?.asset || null,
    blockNumber: normalizedTatum?.blockNumber ?? null,
    confirmations: normalizedTatum?.confirmations ?? null,
    subscriptionType: normalizedTatum?.subscriptionType || null,
    completedAt: reconciledAt,
    ...overrides,
  };
};
