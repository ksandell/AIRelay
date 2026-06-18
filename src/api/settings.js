import { Router } from 'express'
import { config, applyOverrides, _getOverrides } from '../config.js'

const VALID_MODES = new Set(['off', 'alert', 'block', 'redact'])

const SCHEMA = {
  compactorEnabled: 'boolean',
  compactorRequestBody: 'boolean',
  compactorResponseBody: 'boolean',
  compactorToolResultOnly: 'boolean',
  compactorAllowRisky: 'boolean',
  compactorAnsiStripEnabled: 'boolean',
  compactorBlanklineCollapseEnabled: 'boolean',
  compactorDiffCollapseEnabled: 'boolean',
  compactorLockfileDropEnabled: 'boolean',
  compactorLsLongShrinkEnabled: 'boolean',
  compactorNpmNoiseStripEnabled: 'boolean',
  compactorRepeatLineDedupeEnabled: 'boolean',
  compactorStacktraceDedupeEnabled: 'boolean',
  compactorLongFileElideEnabled: 'boolean',
  compactorBase64TruncateEnabled: 'boolean',
  guardrailsEnabled: 'boolean',
  guardrailsSecretsMode: 'mode',
  guardrailsPiiMode: 'mode',
  guardrailsInjectionMode: 'mode',
  guardrailsAwsAccessKeyEnabled: 'boolean',
  guardrailsGithubPatEnabled: 'boolean',
  guardrailsAnthropicKeyEnabled: 'boolean',
  guardrailsOpenaiKeyEnabled: 'boolean',
  guardrailsPrivateKeyEnabled: 'boolean',
  guardrailsJwtEnabled: 'boolean',
  guardrailsGenericHighEntropyEnabled: 'boolean',
  guardrailsEmailEnabled: 'boolean',
  guardrailsPhoneEnabled: 'boolean',
  guardrailsSsnUsEnabled: 'boolean',
  guardrailsCreditCardEnabled: 'boolean',
  guardrailsRoleOverrideEnabled: 'boolean',
  guardrailsSystemPromptLeakEnabled: 'boolean',
  guardrailsToolOverrideEnabled: 'boolean',
  cacheEnabled: 'boolean',
  cacheExactMatchEnabled: 'boolean',
  cacheExactTtlSeconds: 'integer',
  cacheDedupEnabled: 'boolean',
  cacheSpendEnabled: 'boolean',
  cacheSpendDailyLimitUsd: 'number',
  cacheSpendMonthlyLimitUsd: 'number',
  cacheSseFanoutEnabled: 'boolean',
}

const ENV_DEFAULTS = {
  compactorEnabled: false,
  compactorRequestBody: true,
  compactorResponseBody: false,
  compactorToolResultOnly: true,
  compactorAllowRisky: false,
  compactorAnsiStripEnabled: true,
  compactorBlanklineCollapseEnabled: true,
  compactorDiffCollapseEnabled: true,
  compactorLockfileDropEnabled: true,
  compactorLsLongShrinkEnabled: true,
  compactorNpmNoiseStripEnabled: true,
  compactorRepeatLineDedupeEnabled: true,
  compactorStacktraceDedupeEnabled: true,
  compactorLongFileElideEnabled: true,
  compactorBase64TruncateEnabled: true,
  guardrailsEnabled: false,
  guardrailsSecretsMode: 'off',
  guardrailsPiiMode: 'off',
  guardrailsInjectionMode: 'off',
  guardrailsAwsAccessKeyEnabled: true,
  guardrailsGithubPatEnabled: true,
  guardrailsAnthropicKeyEnabled: true,
  guardrailsOpenaiKeyEnabled: true,
  guardrailsPrivateKeyEnabled: true,
  guardrailsJwtEnabled: true,
  guardrailsGenericHighEntropyEnabled: false,
  guardrailsEmailEnabled: true,
  guardrailsPhoneEnabled: true,
  guardrailsSsnUsEnabled: false,
  guardrailsCreditCardEnabled: true,
  guardrailsRoleOverrideEnabled: true,
  guardrailsSystemPromptLeakEnabled: true,
  guardrailsToolOverrideEnabled: true,
  cacheEnabled: false,
  cacheExactMatchEnabled: true,
  cacheExactTtlSeconds: 3600,
  cacheDedupEnabled: true,
  cacheSpendEnabled: false,
  cacheSpendDailyLimitUsd: null,
  cacheSpendMonthlyLimitUsd: null,
  cacheSseFanoutEnabled: false,
}

function buildEffective() {
  return {
    compactorEnabled: config.compactorEnabled,
    compactorRequestBody: config.compactorRequestBody,
    compactorResponseBody: config.compactorResponseBody,
    compactorToolResultOnly: config.compactorToolResultOnly,
    compactorAllowRisky: config.compactorAllowRisky,
    compactorAnsiStripEnabled: config.compactor.ansiStrip,
    compactorBlanklineCollapseEnabled: config.compactor.blanklineCollapse,
    compactorDiffCollapseEnabled: config.compactor.diffCollapse,
    compactorLockfileDropEnabled: config.compactor.lockfileDrop,
    compactorLsLongShrinkEnabled: config.compactor.lsLongShrink,
    compactorNpmNoiseStripEnabled: config.compactor.npmNoiseStrip,
    compactorRepeatLineDedupeEnabled: config.compactor.repeatLineDedupe,
    compactorStacktraceDedupeEnabled: config.compactor.stacktraceDedupe,
    compactorLongFileElideEnabled: config.compactor.longFileElide,
    compactorBase64TruncateEnabled: config.compactor.base64Truncate,
    guardrailsEnabled: config.guardrailsEnabled,
    guardrailsSecretsMode: config.guardrailsSecretsMode,
    guardrailsPiiMode: config.guardrailsPiiMode,
    guardrailsInjectionMode: config.guardrailsInjectionMode,
    guardrailsAwsAccessKeyEnabled: config.guardrails.awsAccessKey,
    guardrailsGithubPatEnabled: config.guardrails.githubPat,
    guardrailsAnthropicKeyEnabled: config.guardrails.anthropicKey,
    guardrailsOpenaiKeyEnabled: config.guardrails.openaiKey,
    guardrailsPrivateKeyEnabled: config.guardrails.privateKey,
    guardrailsJwtEnabled: config.guardrails.jwt,
    guardrailsGenericHighEntropyEnabled: config.guardrails.genericHighEntropy,
    guardrailsEmailEnabled: config.guardrails.email,
    guardrailsPhoneEnabled: config.guardrails.phone,
    guardrailsSsnUsEnabled: config.guardrails.ssnUs,
    guardrailsCreditCardEnabled: config.guardrails.creditCard,
    guardrailsRoleOverrideEnabled: config.guardrails.roleOverride,
    guardrailsSystemPromptLeakEnabled: config.guardrails.systemPromptLeak,
    guardrailsToolOverrideEnabled: config.guardrails.toolOverride,
    cacheEnabled: config.cacheEnabled,
    cacheExactMatchEnabled: config.cacheExactMatchEnabled,
    cacheExactTtlSeconds: config.cacheExactTtlSeconds,
    cacheDedupEnabled: config.cacheDedupEnabled,
    cacheSpendEnabled: config.cacheSpendEnabled,
    cacheSpendDailyLimitUsd: config.cacheSpendDailyLimitUsd,
    cacheSpendMonthlyLimitUsd: config.cacheSpendMonthlyLimitUsd,
    cacheSseFanoutEnabled: config.cacheSseFanoutEnabled,
  }
}

const router = Router()

router.get('/api/settings', (req, res) => {
  res.json({
    effective: buildEffective(),
    overrides: _getOverrides(),
    defaults: ENV_DEFAULTS,
  })
})

router.post('/api/settings', async (req, res) => {
  const patch = req.body
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return res.status(400).json({ error: 'Request body must be a JSON object' })
  }
  for (const [key, value] of Object.entries(patch)) {
    const type = SCHEMA[key]
    if (!type) {
      return res.status(400).json({ error: `Unknown setting key: ${key}` })
    }
    if (type === 'boolean') {
      if (typeof value !== 'boolean') {
        return res
          .status(400)
          .json({ error: `Invalid value for ${key}: expected boolean, got ${typeof value}` })
      }
    }
    if (type === 'mode') {
      if (typeof value !== 'string' || !VALID_MODES.has(value)) {
        return res
          .status(400)
          .json({ error: `Invalid value for ${key}: expected one of off|alert|block|redact` })
      }
    }
    if (type === 'integer') {
      if (!Number.isInteger(value)) {
        return res
          .status(400)
          .json({ error: `Invalid value for ${key}: expected integer, got ${typeof value}` })
      }
    }
    if (type === 'number') {
      if (typeof value !== 'number' && value !== null) {
        return res.status(400).json({ error: `Invalid value for ${key}: expected number or null` })
      }
    }
  }
  await applyOverrides(patch)
  res.json({ effective: buildEffective() })
})

export default router
