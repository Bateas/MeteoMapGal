import { Component, type ReactNode, type ErrorInfo } from 'react';

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
        <div className="flex flex-col items-center justify-center h-full min-h-[120px] bg-slate-900/80 rounded-lg p-6 gap-3">
          <div className="text-red-400 text-lg">⚠</div>
          <div className="text-sm text-slate-300 font-medium">
            Error en {this.props.section}
          </div>
          <div className="text-[10px] text-slate-500 text-center max-w-xs leading-relaxed">
            {this.state.error?.message || 'Error desconocido'}
          </div>
          <button
            onClick={this.handleRetry}
            className="text-[10px] bg-slate-700 text-slate-300 px-4 py-1.5 rounded hover:bg-slate-600 transition-colors mt-1"
          >
            Reintentar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
