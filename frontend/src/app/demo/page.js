import { redirect } from 'next/navigation';

/* /demo is the shareable address — it is the one that gets pasted into a
   message to a venue — but it is not a screen. The demo has an argument and
   the argument has an order: you cannot judge the host's dashboard until you
   have been the guest. So /demo always opens on the invitation.
   `redirect` and not a rewrite, so the address bar tells the visitor where in
   the demo they are and they can send that exact stage to someone else. */
export default function DemoIndex() {
  redirect('/demo/invitation');
}
