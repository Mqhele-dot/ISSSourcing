import { Link } from 'react-router-dom';

export function LoginPrompt() {
  return <p>Not logged in. <Link to="/login">Go to login</Link></p>;
}
