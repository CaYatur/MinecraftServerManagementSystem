import { Component, type ReactNode } from 'react'

interface State {
  error?: Error
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {}

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    // eslint-disable-next-line no-console
    console.error('View crashed:', error)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="center-fill">
          <div>
            <h3>Something went wrong</h3>
            <pre className="dim" style={{ maxWidth: 520, whiteSpace: 'pre-wrap' }}>
              {this.state.error.message}
            </pre>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
