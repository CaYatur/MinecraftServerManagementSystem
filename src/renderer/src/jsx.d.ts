// React 19's @types/react exposes the JSX namespace as `React.JSX` and no longer
// declares a global `JSX` namespace. We re-expose the members we annotate with
// (`JSX.Element`) so bare `JSX.Element` return types keep resolving.
import type React from 'react'

declare global {
  namespace JSX {
    type Element = React.JSX.Element
    type ElementClass = React.JSX.ElementClass
    type IntrinsicElements = React.JSX.IntrinsicElements
  }
}

export {}
