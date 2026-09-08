import DemoChrome from './components/DemoChrome';

/* A server component, so this file can carry the metadata. Everything that
   needs the browser — the API router, the pathname, the stage rail — lives in
   DemoChrome. */

export const metadata = {
  title: 'Try Fancy — open a real invitation, then run the event behind it',
  description:
    'A working demo. Open the invitation as a guest, reply, get your entry pass — '
    + 'then see the guest list, the seating and the analytics the host sees. '
    + 'No signup, nothing sent.',
  openGraph: {
    title: 'Try Fancy — open a real invitation',
    description:
      'Open the invitation, reply as a guest, then see everything the host sees. No signup.',
    url: 'https://fancyrsvp.com/demo',
    siteName: 'Fancy RSVP',
    type: 'website',
    images: [{ url: 'https://fancyrsvp.com/og-image.png', width: 1200, height: 630, alt: 'Fancy RSVP' }],
  },
  /* NO `alternates.canonical` HERE. A layout's metadata is inherited by every
     page under it, so one canonical URL declared at this level would tell a
     crawler that /demo/invitation, /demo/dashboard and /demo/customize are
     all the same page. They are three stages of one argument, not three
     copies of one thing, and each is worth arriving at directly. */
};

export default function DemoLayout({ children }) {
  return <DemoChrome>{children}</DemoChrome>;
}
