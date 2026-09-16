const TRUTHY = new Set(["1", "true", "yes"]);

function enabled(value) {
  return TRUTHY.has(String(value ?? "").trim().toLowerCase());
}

export function resolveDemoSeedPolicy(env = process.env) {
  const requested = enabled(env.SEED_DEMO_DATA_ON_START);
  const production = String(env.NODE_ENV ?? "").trim().toLowerCase() === "production";
  const productionOverride = enabled(env.ALLOW_PRODUCTION_DEMO_SEED);

  return {
    requested,
    production,
    productionOverride,
    blocked: requested && production && !productionOverride,
    shouldRun: requested && (!production || productionOverride),
  };
}
