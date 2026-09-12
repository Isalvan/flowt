const serviceAliases = {
  spotify: ["spotify"],
  netflix: ["netflix"],
  chatgpt: ["chatgpt", "openai"],
  gemini: ["gemini"],
  "google-play": ["google play"],
} as const;

export type ServiceKey = keyof typeof serviceAliases;

export const normalizeServiceName = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const containsAlias = (normalizedValue: string, alias: string): boolean =>
  ` ${normalizedValue} `.includes(` ${alias} `);

export const resolveServiceKey = (value: string): ServiceKey | undefined => {
  const normalized = normalizeServiceName(value);

  return (
    Object.entries(serviceAliases) as Array<[ServiceKey, readonly string[]]>
  ).find(([, aliases]) =>
    aliases.some((alias) => containsAlias(normalized, alias)),
  )?.[0];
};

export const isSubscriptionMovement = (
  concept: string,
  subscriptionNames: string[],
): boolean => {
  const movementService = resolveServiceKey(concept);
  const normalizedConcept = normalizeServiceName(concept);

  return subscriptionNames.some((name) => {
    const subscriptionService = resolveServiceKey(name);
    if (movementService && subscriptionService)
      return movementService === subscriptionService;

    const normalizedName = normalizeServiceName(name);
    return Boolean(
      normalizedName &&
        normalizedName === normalizedConcept &&
        normalizedName.length >= 5,
    );
  });
};
