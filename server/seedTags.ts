import type { TagKind } from '../shared/model'

/** Starter tags created (encrypted) at setup. Rename, archive or delete any of them. */
export const SEED_TAG_NAMES_BY_KIND: Record<TagKind, string[]> = {
  context: ['Work', 'Home', 'Social', 'Health', 'Money', 'Travel', 'Night'],
  emotion: ['Anxious', 'Worried', 'Panicky', 'Overwhelmed', 'Irritable', 'Ashamed', 'Sad', 'Lonely'],
  sensation: [
    'Racing heart',
    'Tight chest',
    'Shallow breathing',
    'Muscle tension',
    'Stomach churning',
    'Sweating',
    'Restless',
    'Dizzy',
    'Hot face',
  ],
  pattern: [
    'Catastrophizing',
    'Mind reading',
    'Fortune telling',
    'All-or-nothing',
    'Overestimating danger',
    'Underestimating coping',
    'Should statements',
    'Emotional reasoning',
  ],
  technique: [
    'Slow breathing',
    'Grounding (5 senses)',
    'Named the thought',
    'Stepped back',
    'Went for a walk',
    'Reached out to someone',
    'Did it anyway',
    'Left the situation',
  ],
}
