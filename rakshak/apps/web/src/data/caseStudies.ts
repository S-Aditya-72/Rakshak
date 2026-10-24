// Documented background for the two case studies. UI-only: none of this text is ever sent to a model.
// The recreations themselves (fictional names, original synthetic dialogue) live in scenarios/case-studies/.
//
// Sourcing: facts below were checked on 2026-10-24 against the sources listed. cbc.ca and justice.gov blocked
// automated access from our environment, so the text was read from Internet Archive snapshots of those exact URLs
// (snapshot dates given). Re-check the live pages before presenting.

export interface Source {
  title: string;
  publisher: string;
  date: string;
  url: string;
  note?: string;
}

export interface CaseStudy {
  key: string;
  scenarioId: string;
  person: string;
  pattern: string;
  /** Short, sourced facts. Each fact cites one or more sources by index. */
  documented: { text: string; sources: number[] }[];
  /** Messages in the fictional recreation the team considers concerning (UI-only). Used to show what the live
   *  pipeline did or did not flag in this run, never to force an alert. 1-based script positions. */
  keyMoments: { at: number; why: string }[];
  support: string[];
  sources: Source[];
}

export const RECREATION_NOTICE = 'Fictional recreation inspired by a documented abuse pattern. These are not the actual messages or participants.';

export const CASE_STUDIES: CaseStudy[] = [
  {
    key: 'amanda-todd',
    scenarioId: 'cs-sustained-coercion',
    person: 'Amanda Todd',
    pattern: 'Sustained online coercion, threatened exposure and repeated harassment over years, across many accounts',
    documented: [
      { text: 'Amanda Todd, a teenager from British Columbia, Canada, was exploited online from November 2009 to February 2012.', sources: [0] },
      { text: 'The court found that the offender used 22 different aliases to contact her on Facebook, YouTube and Skype, demanded webcam shows, sent more than 700 messages and made persistent online threats.', sources: [0] },
      { text: 'He threatened to send compromising images of her to her friends and family. When she refused his demands, he carried out those threats, and used alias accounts to pose as a young friend and as a concerned adult.', sources: [0] },
      { text: 'Before her death she uploaded a nine-minute video describing the abuse and its effect on her life, told on flash cards. She died by suicide on 10 October 2012.', sources: [0] },
      { text: 'In August 2022 a Dutch man, Aydin Coban, was convicted in British Columbia of extortion, possession of child pornography, child luring and criminal harassment, and on 14 October 2022 was sentenced to 13 years. The judge found that his conduct caused profound harm that contributed to her mental-health difficulties, without finding it was the dominating factor in her death.', sources: [0] },
      { text: 'He was already serving a sentence of about 11 years in the Netherlands for similar crimes against other victims.', sources: [0] },
    ],
    keyMoments: [
      { at: 4, why: 'moves to video and asks for secrecy from parents' },
      { at: 8, why: 'threatens exposure unless the child complies' },
      { at: 12, why: 'a new account repeats the threat to the new class' },
      { at: 13, why: 'threat widened to the parents' },
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
    pattern: 'Rapid financial sextortion: a fake persona, a request for an explicit image, threatened exposure and payment demands',
    documented: [
      { text: 'Jordan DeMay, a 17-year-old high-school student from Marquette, Michigan, USA, died on 25 March 2022 as a result of a sextortion scheme.', sources: [0, 1] },
      { text: 'According to the plea agreements, the offenders bought hacked social-media accounts, posed as young women, researched where victims lived and studied and who their family and friends were, and solicited sexually explicit images.', sources: [0] },
      { text: 'They then threatened to send collages of those images, alongside photos of the victim’s school, family and friends, to the victim’s family, friends and classmates unless the victim paid money through online cash apps.', sources: [0] },
      { text: 'The indictment alleged that on 25 March 2022, the day he died, Jordan was threatened with exposure and asked for $1,000, and that after he paid $300 the threats continued.', sources: [1] },
      { text: 'Two Nigerian brothers, Samuel and Samson Ogoshi, pleaded guilty in April 2024 to conspiracy to sexually exploit minors and on 5 September 2024 were each sentenced to 210 months in prison. The scheme targeted more than 100 victims, including at least 11 minors.', sources: [0, 2] },
    ],
    keyMoments: [
      { at: 4, why: 'asks for private pictures and for the chat to be deleted' },
      { at: 6, why: 'threatened exposure to followers and family with a payment demand' },
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
    ],
  },
];

export const caseStudyFor = (key: string | null | undefined) => CASE_STUDIES.find((c) => c.key === key) ?? null;
