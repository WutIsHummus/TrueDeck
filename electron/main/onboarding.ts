import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getGlobalDataDir } from './paths'

export interface OnboardingState {
  completed: boolean
  completedAt?: number
  skipped?: boolean
  stepReached?: number
}

function path(): string {
  return join(getGlobalDataDir(), 'onboarding.json')
}

export function getOnboardingState(): OnboardingState {
  try {
    if (existsSync(path())) {
      return JSON.parse(readFileSync(path(), 'utf8')) as OnboardingState
    }
  } catch {
    // ignore
  }
  return { completed: false }
}

export function saveOnboardingState(state: OnboardingState): OnboardingState {
  mkdirSync(getGlobalDataDir(), { recursive: true })
  writeFileSync(path(), JSON.stringify(state, null, 2), 'utf8')
  return state
}

export function completeOnboarding(skipped = false): OnboardingState {
  return saveOnboardingState({
    completed: true,
    skipped,
    completedAt: Date.now()
  })
}

export function resetOnboarding(): OnboardingState {
  return saveOnboardingState({ completed: false, stepReached: 0 })
}
