import { Link } from 'react-router-dom';
import type { ProfileLinks } from '../lib/types';
import { PROFILE_LINKS } from '../lib/types';

/** Simple monochrome marks for each link (drawn in the text colour, so they suit both themes). */
const ICON: Record<keyof ProfileLinks, JSX.Element> = {
  linkedin: <path d="M4.5 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM3 9h3v12H3Zm6 0h2.9v1.7c.5-.9 1.7-2 3.6-2 3.7 0 4.5 2.4 4.5 5.6V21h-3v-5.9c0-1.5-.1-3.3-2.1-3.3s-2.4 1.6-2.4 3.2v6H9Z" />,
  twitter: <path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8Zm-1.1 16.2h1.7L7.4 4.7H5.6Z" />,
  researchgate: <path d="M3 3h18v18H3Zm5.6 4.5v9h1.9v-3.6h.9l2.1 3.6h2.2l-2.4-3.9c1.2-.4 1.9-1.3 1.9-2.6 0-1.6-1.2-2.5-3.1-2.5Zm1.9 1.5h1.2c.9 0 1.3.4 1.3 1.1 0 .8-.5 1.2-1.4 1.2h-1.1Z" fillRule="evenodd" />,
  github: <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.8V21c0 .3.2.6.7.5A10 10 0 0 0 12 2Z" />,
  youtube: <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3Z" />,
  ssrn: <path d="M4 4h16v16H4Zm3.2 10.3c.6.8 1.7 1.3 2.9 1.3 1.6 0 2.7-.8 2.7-2.1 0-1.2-.8-1.7-2.1-2.1-.9-.3-1.3-.5-1.3-.9 0-.4.4-.6.9-.6.6 0 1.1.3 1.4.7l1-1c-.5-.7-1.4-1.1-2.4-1.1-1.5 0-2.5.8-2.5 2 0 1.2.8 1.7 2 2 1 .3 1.4.5 1.4 1s-.4.7-1.1.7c-.7 0-1.3-.3-1.8-.9Z" fillRule="evenodd" />,
  website: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6h-3a15.6 15.6 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8ZM12 4.1A13.7 13.7 0 0 1 13.9 8h-3.8A13.7 13.7 0 0 1 12 4.1ZM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4Zm.8 2h3a15.6 15.6 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16Zm3-8h-3a8 8 0 0 1 4.4-3.6A15.6 15.6 0 0 0 8.1 8ZM12 19.9a13.7 13.7 0 0 1-1.9-3.9h3.8a13.7 13.7 0 0 1-1.9 3.9Zm2.3-5.9H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4Zm.2 5.6a15.6 15.6 0 0 0 1.4-3.6h3a8 8 0 0 1-4.4 3.6Zm1.8-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4Z" />,
};

/**
 * "Follow me": the researcher's own social and research links, as labelled icon buttons. Shown only when at least
 * one link is given; the owner sees an invitation to add them instead.
 */
export function FollowMe({ links, isOwner }: { links?: Partial<ProfileLinks>; isOwner: boolean }) {
  const given = PROFILE_LINKS.filter((l) => links?.[l.key]);
  if (!given.length) {
    return isOwner ? <p className="follow-empty">Add your LinkedIn, X and other links so people can follow your work. <Link to="/biodata/edit">Add links</Link></p> : null;
  }
  return (
    <section className="follow" aria-label="Follow me">
      <h2>Follow me</h2>
      <ul>
        {given.map((l) => (
          <li key={l.key}>
            <a href={links![l.key]} target="_blank" rel="noopener noreferrer me" className={`follow-${l.key}`} aria-label={`${l.label} (opens in a new tab)`}>
              <svg viewBox="0 0 24 24" aria-hidden>{ICON[l.key]}</svg>
              <span>{l.key === 'website' ? 'Website' : l.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
