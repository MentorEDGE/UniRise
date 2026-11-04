import logoDark from '../assets/unirise-by-mentoredge-dark.png';
import logo from '../assets/unirise-by-mentoredge.png';

/** "UniRise by MentorEdge" combined logo; CSS shows the version that suits the current theme. */
export function Logo() {
  return (
    <span className="brand">
      <img className="brand-logo logo-light" src={logo} alt="UniRise by MentorEdge" />
      <img className="brand-logo logo-dark" src={logoDark} alt="UniRise by MentorEdge" />
    </span>
  );
}
