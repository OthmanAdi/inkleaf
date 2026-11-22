export type LessonKind = 'stores' | 'catapult' | 'bounce' | 'heating' | 'lifting' | 'lamps' | 'grid';

export interface LessonPose {
  /** Normalized channels interpreted by this lesson's figure. */
  readonly primary: number;
  readonly secondary: number;
  readonly highlight: number;
}

export interface LessonSample {
  readonly pose: LessonPose;
  readonly readings: readonly { label: string; value: string }[];
  readonly note: string;
}

export interface InteractiveLesson {
  readonly id: string;
  readonly kind: LessonKind;
  readonly title: string;
  readonly description: string;
  readonly prediction: {
    readonly question: string;
    readonly options: readonly string[];
    readonly correct: number;
    readonly explanation: string;
  };
  readonly term: { readonly label: string; readonly definition: string };
  readonly settings: { readonly label: string; readonly options: readonly string[] };
  readonly action: string;
  readonly duration: number;
  readonly sample: (seconds: number, setting: number) => LessonSample;
}
