import { Component, type ReactNode, type ErrorInfo } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** What section this boundary wraps (shown in the fallback UI) */
  section: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render errors in children and shows a recovery UI
 * instead of crashing the entire application.
 *
 * Usage:
 *   <ErrorBoundary section="Mapa">
 *     <WeatherMap />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.section}]`, error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="g-theme gc-failed">
          <WeatherIcon id="alert-triangle" size={24} />
          <b>Error en {this.props.section}</b>
          <p className="gc-small">{this.state.error?.message || 'Error desconocido'}</p>
          <button type="button" onClick={this.handleRetry} className="gc-btn">
            Reintentar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
