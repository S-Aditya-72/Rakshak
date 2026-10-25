// Documented background for the two case studies. UI-only: none of this text is ever sent to a model.
// The reconstructions themselves (reconstructed, non-graphic dialogue) live in scenarios/case-studies/. They show the
// real case identities on screen; the models see only neutral names (see apps/server/rakshak_server/scenarios.py).
//
// Sourcing: facts below were checked on 2026-10-24 against the sources listed. cbc.ca and justice.gov blocked
// automated access from our environment, so the text was read from Internet Archive snapshots of those exact URLs
// (snapshot dates given). On 2026-10-25 the account name, the roles of Samuel and Samson Ogoshi, the amounts and
// Coban's 22 aliases were cross-checked against news reports of the indictment, pleas and sentencing (WLUC, CTV).
// Re-check the live pages before presenting.

export interface Source {
  title: string;
  publisher: string;
  date: string;
  url: string;
  note?: string;
}

/** A short statement that cites one or more sources by index. */
export interface Sourced {
  text: string;
  sources: number[];
}

export interface CaseStudy {
  key: string;
  scenarioId: string;
  person: string;
  /** One sentence shown before the Play button. */
  context: Sourced;
  /** Who was convicted or charged, in one line. */
  attribution: Sourced;
  /** How the reconstruction labels accounts and attributes its lines. */
  labelling: string;
  /** Longer background, shown only in the collapsed "Case background & sources" section. */
  documented: Sourced[];
  /** Messages in the reconstruction the team considers concerning (UI-only). Used to show what the live pipeline did
   *  or did not flag in this run, never to force an alert. 1-based script positions. */
  keyMoments: { at: number; why: string }[];
  support: string[];
  sources: Source[];
}

export const RECONSTRUCTION_LABEL = 'Fictional reconstruction of the incident';
export const RECONSTRUCTION_NOTE = 'Reconstructed dialogue; not an actual transcript. Timing is illustrative.';
export const INTERVENTION_HEADLINE = 'Could an earlier alert have changed the outcome?';

export const CASE_STUDIES: CaseStudy[] = [
  {
    key: 'amanda-todd',
    scenarioId: 'cs-sustained-coercion',
    person: 'Amanda Todd',
    context: { text: 'A teenager in British Columbia, Canada, sexually extorted and harassed online from 2009 to 2012 by a man who used 22 different aliases.', sources: [0] },
    attribution: { text: 'Aydin Coban, a Dutch man, was convicted in 2022 of extortion, child luring, criminal harassment and possession of child pornography, and sentenced to 13 years.', sources: [0] },
    labelling:
      '“Aydin Coban · reconstructed alias 1” and “… alias 2” are illustrative labels for two of the many accounts the court found he used, not his verified historical handles. They stay separate accounts in RAKSHAK: it never links them because of their names.',
    documented: [
      { text: 'Amanda Todd, a teenager from British Columbia, Canada, was exploited online from November 2009 to February 2012.', sources: [0] },
      { text: 'The court found that the offender used 22 different aliases to contact her on Facebook, YouTube and Skype, demanded webcam shows, sent more than 700 messages and made persistent online threats.', sources: [0] },
      { text: 'He threatened to send compromising images of her to her friends and family. When she refused his demands, he carried out those threats, and used alias accounts to pose as a young friend and as a concerned adult.', sources: [0] },
      { text: 'Before her death she uploaded a nine-minute video describing the abuse and its effect on her life, told on flash cards. She died by suicide on 10 October 2012.', sources: [0] },
      { text: 'In August 2022 Aydin Coban was convicted in British Columbia and on 14 October 2022 was sentenced to 13 years. The judge found that his conduct caused profound harm that contributed to her mental-health difficulties, without finding it was the dominating factor in her death.', sources: [0] },
      { text: 'He was already serving a sentence of about 11 years in the Netherlands for similar crimes against other victims.', sources: [0] },
    ],
    keyMoments: [
      { at: 4, why: 'moves to webcam and asks for secrecy from parents' },
      { at: 8, why: 'threatens exposure to friends and family unless she complies' },
      { at: 12, why: 'a second account repeats the threat after the block' },
      { at: 13, why: 'threat widened to her family' },
    ],
    support: [
      'Early secrecy and platform-move cues can produce a private nudge to the child before any threat is made.',
      'Once a threat appears, the guardian receives an alert with cue types and dates, without message text, and can open Get help.',
      'Get help focuses first on the child: they are not in trouble, and nothing they did makes the threats their fault.',
      'Evidence review lets the guardian keep a dated, redacted record before any account is blocked or a chat is deleted.',
      'A brand-new account that appears after a block is flagged for human review. RAKSHAK does not assume it is the same person.',
    ],
    sources: [
      {
        title: 'Aydin Coban sentenced to 13 years for sexual extortion of Amanda Todd',
        publisher: 'CBC News (Josh Grant, with files from the Canadian Press)',
        date: '14 October 2022',
        url: 'https://www.cbc.ca/news/canada/british-columbia/aydin-coban-sentencing-october-14-1.6616874',
        note: 'Read via the Internet Archive snapshot of 17 November 2022 (web.archive.org/web/20221117081237/…).',
      },
    ],
  },
  {
    key: 'jordan-demay',
    scenarioId: 'cs-rapid-sextortion',
    person: 'Jordan DeMay',
    context: { text: 'A 17-year-old from Marquette, Michigan, USA, who died on 25 March 2022 after being sextorted through an Instagram account posing as a young woman.', sources: [0, 1] },
    attribution: {
      text: 'Samuel Ogoshi and Samson Ogoshi pleaded guilty to conspiracy to sexually exploit minors and were each sentenced to 210 months (17½ years). The indictment alleged Samuel Ogoshi used the account “dani.robertts” to extort Jordan.',
      sources: [0, 1, 3],
    },
    labelling: 'Every reconstructed line comes from the account dani.robertts, the identifier named in the indictment. No line is attributed to either brother individually.',
    documented: [
      { text: 'Jordan DeMay, a 17-year-old high-school student from Marquette, Michigan, USA, died on 25 March 2022 as a result of a sextortion scheme.', sources: [0, 1] },
      { text: 'According to the plea agreements, the offenders bought hacked social-media accounts, posed as young women, researched where victims lived and studied and who their family and friends were, and solicited sexually explicit images.', sources: [0] },
      { text: 'They then threatened to send collages of those images, alongside photos of the victim’s school, family and friends, to the victim’s family, friends and classmates unless the victim paid money through online cash apps.', sources: [0] },
      { text: 'The indictment alleged that on 25 March 2022, the day he died, Jordan was threatened with exposure and asked for $1,000, and that after he paid $300 the threats continued.', sources: [1, 3] },
      { text: 'Samuel and Samson Ogoshi pleaded guilty in April 2024 and on 5 September 2024 were each sentenced to 210 months in prison. The scheme targeted more than 100 victims, including at least 11 minors.', sources: [0, 2] },
    ],
    keyMoments: [
      { at: 4, why: 'asks for private pictures and for the chat to be deleted' },
      { at: 6, why: 'threatened exposure to followers, family and friends with a payment demand' },
      { at: 8, why: 'pressure to pay immediately' },
      { at: 10, why: 'demand repeated after a payment' },
    ],
    support: [
      'A private-image request combined with secrecy can surface a calm nudge to the child at the first request.',
      'A payment demand with threatened exposure sets a Level 3 floor in the engine if the models report it, which alerts the guardian at once.',
      'Get help tells the guardian not to pay, not to delete anything, and that the child is not in trouble.',
      'Evidence review prepares a dated, redacted record. Complaint options point to official channels; RAKSHAK never contacts anyone itself.',
      'For images taken under 18, Take It Down can create a hash on the device so participating platforms can look for copies. Removal is not guaranteed.',
    ],
    sources: [
      {
        title: 'Ogoshi Brothers Sentenced To Lengthy Prison Terms In Sextortion Scheme That Resulted In Death Of Teen',
        publisher: 'U.S. Attorney’s Office, Western District of Michigan (U.S. Department of Justice)',
        date: '5 September 2024',
        url: 'https://www.justice.gov/usao-wdmi/pr/2024_0905_Ogoshi_Brothers_Sentenced',
        note: 'Read via the Internet Archive snapshot of 14 January 2025.',
      },
      {
        title: 'Three Nigerian Men Awaiting Extradition For Committing Sexual Extortion',
        publisher: 'U.S. Attorney’s Office, Western District of Michigan (U.S. Department of Justice)',
        date: '3 May 2023',
        url: 'https://www.justice.gov/usao-wdmi/pr/2023_0503_Sextortion_Indictment',
        note: 'Describes allegations in the indictment at the time. Read via the Internet Archive snapshot of 9 January 2024.',
      },
      {
        title: 'Two Nigerian Defendants Plead Guilty to Sextortion',
        publisher: 'U.S. Attorney’s Office, Western District of Michigan (U.S. Department of Justice)',
        date: '10 April 2024',
        url: 'https://www.justice.gov/usao-wdmi/pr/2024_0410_Ogoshi_Plea',
        note: 'Read via the Internet Archive snapshot of 25 December 2024.',
      },
      {
        title: '3 Nigerian men charged in ‘Sextortion’ ring and Jordan DeMay death',
        publisher: 'WLUC TV6 (Upper Michigan’s Source)',
        date: '3 May 2023',
        url: 'https://www.uppermichiganssource.com/2023/05/03/3-nigerian-men-charged-sextortion-ring-jordan-demay-death/',
        note: 'Reports the unsealed indictment: the Instagram account “dani.robertts”, the $1,000 demand and the $300 payment.',
      },
    ],
  },
];

export const caseStudyFor = (key: string | null | undefined) => CASE_STUDIES.find((c) => c.key === key) ?? null;
