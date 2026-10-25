// The demo gallery: illustrated stand-ins, so the photo flow never touches real photos on the phone.

export interface GalleryPhoto {
  key: string;
  label: string;
  emoji: string;
  bg: string;
  /** A selfie is the kind of photo RAKSHAK pauses before it is sent to a flagged contact. */
  personal: boolean;
}

export const GALLERY: GalleryPhoto[] = [
  { key: 'selfie', label: 'Selfie', emoji: '🤳', bg: 'linear-gradient(160deg,#ffb199,#ff0844)', personal: true },
  { key: 'mirror', label: 'Mirror selfie', emoji: '🪞', bg: 'linear-gradient(160deg,#a18cd1,#fbc2eb)', personal: true },
  { key: 'school', label: 'School uniform', emoji: '🎒', bg: 'linear-gradient(160deg,#84fab0,#8fd3f4)', personal: true },
  { key: 'dog', label: 'Bruno the dog', emoji: '🐶', bg: 'linear-gradient(160deg,#f6d365,#fda085)', personal: false },
  { key: 'sunset', label: 'Sunset', emoji: '🌅', bg: 'linear-gradient(160deg,#fa709a,#fee140)', personal: false },
  { key: 'cake', label: 'Birthday cake', emoji: '🎂', bg: 'linear-gradient(160deg,#fccb90,#d57eeb)', personal: false },
];

export const photoOf = (key?: string) => GALLERY.find((g) => g.key === key);
