/**
 * PERF: Lua scripts Redis pour opérations atomiques
 * Réduit le nombre de round-trips réseau en exécutant plusieurs opérations côté serveur
 */

/**
 * Touch session: Met à jour le TTL d'une session de manière atomique
 * KEYS[1]: clé de la session
 * ARGV[1]: nouveau TTL en secondes
 * Retourne: 1 si succès, 0 si la session n'existe pas
 */
export const touchSessionScript = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])

if redis.call('EXISTS', key) == 1 then
  redis.call('EXPIRE', key, ttl)
  return 1
end

return 0
`;

/**
 * Get and refresh: Récupère une valeur et refresh son TTL en une opération
 * KEYS[1]: clé
 * ARGV[1]: nouveau TTL en secondes
 * Retourne: valeur ou nil
 */
export const getAndRefreshScript = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])

local value = redis.call('GET', key)

if value then
  redis.call('EXPIRE', key, ttl)
end

return value
`;

/**
 * Atomic counter with limit: Incrémente un compteur seulement s'il est sous la limite
 * KEYS[1]: clé du compteur
 * ARGV[1]: limite maximum
 * ARGV[2]: TTL en secondes
 * Retourne: nouveau count ou -1 si limite atteinte
 */
export const incrementWithLimitScript = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local current = tonumber(redis.call('GET', key) or 0)

if current >= limit then
  return -1
end

local new_value = redis.call('INCR', key)

if new_value == 1 then
  redis.call('EXPIRE', key, ttl)
end

return new_value
`;

/**
 * Set with NX and EX atomique: Set seulement si n'existe pas, avec TTL
 * KEYS[1]: clé
 * ARGV[1]: valeur
 * ARGV[2]: TTL en secondes
 * Retourne: 1 si créé, 0 si existe déjà
 */
export const setNxExScript = `
local key = KEYS[1]
local value = ARGV[1]
local ttl = tonumber(ARGV[2])

if redis.call('EXISTS', key) == 1 then
  return 0
end

redis.call('SETEX', key, ttl, value)
return 1
`;

/**
 * Cleanup expired entries: Nettoie les entrées expirées d'une liste
 * KEYS[1]: clé de la sorted set
 * ARGV[1]: timestamp cutoff (supprimer avant cette date)
 * Retourne: nombre d'entrées supprimées
 */
export const cleanupExpiredScript = `
local key = KEYS[1]
local cutoff = tonumber(ARGV[1])

return redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
`;

/**
 * Batch delete with pattern: Supprime toutes les clés matchant un pattern
 * KEYS: tableau de clés à supprimer
 * Retourne: nombre de clés supprimées
 */
export const batchDeleteScript = `
local count = 0

for i, key in ipairs(KEYS) do
  if redis.call('DEL', key) == 1 then
    count = count + 1
  end
end

return count
`;

/**
 * Get multiple with fallback: Récupère plusieurs clés avec des valeurs par défaut
 * KEYS: tableau de clés à récupérer
 * ARGV: tableau de valeurs par défaut (même ordre que KEYS)
 * Retourne: tableau de valeurs (value ou default)
 */
export const getMultipleWithFallbackScript = `
local results = {}

for i, key in ipairs(KEYS) do
  local value = redis.call('GET', key)
  if value then
    table.insert(results, value)
  else
    table.insert(results, ARGV[i])
  end
end

return results
`;

/**
 * Rate limit check: Vérifie et incrémente un rate limiter atomiquement
 * KEYS[1]: clé du rate limiter
 * ARGV[1]: limite maximum
 * ARGV[2]: fenêtre en secondes
 * Retourne: { allowed: 1 ou 0, current: count actuel, ttl: temps restant }
 */
export const rateLimitCheckScript = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

local current = tonumber(redis.call('GET', key) or 0)

if current >= limit then
  local ttl = redis.call('TTL', key)
  return {0, current, ttl}
end

local new_value = redis.call('INCR', key)

if new_value == 1 then
  redis.call('EXPIRE', key, window)
end

local ttl = redis.call('TTL', key)
return {1, new_value, ttl}
`;

/**
 * Helper: Charge un script Lua dans Redis et retourne son SHA1
 */
export async function loadScript(redis: any, script: string): Promise<string> {
  return redis.script("LOAD", script);
}

/**
 * Helper: Exécute un script Lua par son SHA1
 */
export async function evalSha(
  redis: any,
  sha: string,
  keys: string[],
  args: (string | number)[],
): Promise<any> {
  return redis.evalsha(sha, keys.length, ...keys, ...args);
}
