import * as React from "react";

import { DEPLOYMENTS_SHOWN_SYMBOLS, DeploymentsShown, StageSymbol, symbolsLabel } from "../Contracts";

/** The same status colours and glyphs as the Deployment section on the work item. */
const SUCCESS = "var(--component-status-success, rgba(85, 163, 98, 1))";
const INFO = "var(--component-status-info, rgba(0, 120, 212, 1))";
const NEUTRAL = "var(--component-status-neutral, rgba(102, 102, 102, 1))";

const CHECK =
    "M6.062 11.144l-.003-.002-1.784-1.785A.937.937 0 1 1 5.6 8.031l1.125 1.124 3.88-3.88A.937.937 0 1 1 11.931 6.6l-4.54 4.54-.004.004a.938.938 0 0 1-1.325 0z";
const CLOCK =
    "M8 3.5a.9.9 0 0 1 .9.9v3.325l2.002 2.001A.9.9 0 1 1 9.629 11L7.408 8.778A.898.898 0 0 1 7.1 8.1V4.4a.9.9 0 0 1 .9-.9z";
const RING = "M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm0-1.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z";

const SIZE = 16;
const GAP = 20;
const SCALE = 1.25;

function Symbol(props: { symbol: StageSymbol; x: number }): JSX.Element {
    const { symbol, x } = props;
    if (symbol === "notStarted") {
        return (
            <g transform={`translate(${x} 0)`} style={{ color: NEUTRAL }}>
                <circle cx="8" cy="8" r="7" fill="#fff" />
                <path d={RING} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
            </g>
        );
    }
    return (
        <g transform={`translate(${x} 0)`} style={{ color: symbol === "completed" ? SUCCESS : INFO }}>
            <circle cx="8" cy="8" r="8" fill="currentColor" />
            <path d={symbol === "completed" ? CHECK : CLOCK} fill="#fff" fillRule="evenodd" clipRule="evenodd" />
        </g>
    );
}

/** Five stages in a row, drawn like a pipeline, that show what the selected option includes. */
export default function ShownSymbols(props: { shown: DeploymentsShown }): JSX.Element {
    const symbols = DEPLOYMENTS_SHOWN_SYMBOLS[props.shown];
    const width = symbols.length * SIZE + (symbols.length - 1) * GAP;

    return (
        <svg
            className="dsb-symbols"
            viewBox={`0 0 ${width} ${SIZE}`}
            width={width * SCALE}
            height={SIZE * SCALE}
            role="img"
            aria-label={symbolsLabel(props.shown)}
            focusable="false"
        >
            {symbols.slice(1).map((_symbol, index) => (
                <line
                    key={`link-${index}`}
                    x1={(index + 1) * (SIZE + GAP) - GAP + 4}
                    x2={(index + 1) * (SIZE + GAP) - 4}
                    y1={SIZE / 2}
                    y2={SIZE / 2}
                    stroke="rgba(0, 0, 0, 0.22)"
                    strokeWidth="1.5"
                />
            ))}
            {symbols.map((symbol, index) => (
                <Symbol key={index} symbol={symbol} x={index * (SIZE + GAP)} />
            ))}
        </svg>
    );
}
