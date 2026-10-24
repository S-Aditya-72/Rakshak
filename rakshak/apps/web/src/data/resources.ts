// Support and reporting resources shown in "Get help". Checked on 2026-10-24 against the official sources cited.
// Re-check before any real use: services, numbers and portal options change.

export interface Resource {
  name: string;
  what: string;
  contact?: string;
  url?: string;
  source: { label: string; url: string };
}

export const SUPPORT: Resource[] = [
  {
    name: 'Emergency (ERSS)',
    what: 'If a child is in immediate danger.',
    contact: '112',
    source: { label: 'PIB, Child Helpline integration with ERSS-112 (2023)', url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=1933794' },
  },
  {
    name: 'Child Helpline',
    what: 'Ministry of Women and Child Development helpline for children in need of care and protection, being integrated with ERSS-112.',
    contact: '1098',
    url: 'https://wcd.gov.in/child/child-helpline',
    source: { label: 'Ministry of Women and Child Development', url: 'https://wcd.gov.in/child/child-helpline' },
  },
  {
    name: 'Tele-MANAS',
    what: 'Free 24×7 mental-health support from the Ministry of Health and Family Welfare, in many languages, for the child or for you.',
    contact: '14416 or 1800-89-14416',
    url: 'https://telemanas.mohfw.gov.in/home',
    source: { label: 'Ministry of Health and Family Welfare, Tele-MANAS', url: 'https://telemanas.mohfw.gov.in/home' },
  },
];

export const REPORTING = {
  portal: {
    name: 'National Cyber Crime Reporting Portal',
    url: 'https://cybercrime.gov.in',
    what: 'Government of India portal (I4C, Ministry of Home Affairs) to report all types of cybercrime, with a special focus on crimes against women and children. Complaints are routed to the State/UT police based on the details provided.',
    sources: [
      { label: 'PIB, Lok Sabha reply, 7 Feb 2023', url: 'https://pib.gov.in/PressReleasePage.aspx?PRID=1896984' },
      { label: 'PIB, Lok Sabha reply, 5 Aug 2026', url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2294949' },
    ],
  },
  helpline1930: {
    name: 'National Cyber Crime Helpline 1930',
    what: 'Toll-free help with lodging online cyber complaints. Call quickly if money has been paid: it is also the route for reporting online financial fraud.',
    sources: [
      { label: 'PIB, 23 Mar 2022', url: 'https://www.pib.gov.in/Pressreleaseshare.aspx?PRID=1808686' },
      { label: 'PIB, 7 Feb 2023', url: 'https://pib.gov.in/PressReleasePage.aspx?PRID=1896984' },
    ],
  },
  anonymous: {
    what: 'Under "Report Women/Child Related Crime", the portal offers a "Report Anonymously" option for certain categories of offences against women and children, without disclosing personal identity details. The Government has described these categories as child sexual abuse material, rape/gang-rape imagery and sexually explicit content. Other complaints use "Report and Track", which asks for your contact details and lets you follow the complaint.',
    sources: [
      { label: 'PIB, Lok Sabha reply, 5 Aug 2026', url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2294949' },
      { label: 'PIB, Digital Exploitation of Children, 18 Jul 2019', url: 'https://www.pib.gov.in/Pressreleaseshare.aspx?PRID=1579351' },
    ],
  },
  identity: {
    what: 'Indian law (POCSO Act, 2012, section 23) forbids media reports from disclosing the identity of a child, including name, address, photograph, family details, school or neighbourhood. When you make a complaint, ask how the child’s identity will be protected. This is different from an anonymous complaint: the police may still need to contact you.',
    source: { label: 'India Code, Protection of Children from Sexual Offences Act, 2012', url: 'https://www.indiacode.nic.in/handle/123456789/2079?locale=en' },
  },
  takeItDown: {
    name: 'Take It Down (NCMEC)',
    url: 'https://takeitdown.ncmec.org/',
    what: 'For nude or sexual images or videos taken when the person was under 18. A hash is created on your device (the image is not uploaded) and shared with participating platforms so they can look for copies. Platforms may not be able to remove content that is already posted, so removal is not guaranteed.',
    source: { label: 'Take It Down, NCMEC', url: 'https://takeitdown.ncmec.org/' },
  },
};
