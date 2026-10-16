import { Link } from 'react-router'

export default function NotFoundPage() {
  return (
    <div className="container page">
      <div className="empty">
        <h1>Page not found</h1>
        <p className="muted">That page doesn’t exist (anymore).</p>
        <Link to="/" className="btn btn-primary">
          Go home
        </Link>
      </div>
    </div>
  )
}
