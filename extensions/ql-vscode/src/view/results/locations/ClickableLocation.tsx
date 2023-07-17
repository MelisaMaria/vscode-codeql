import * as React from "react";
import { useCallback } from "react";
import { ResolvableLocationValue } from "../../../common/bqrs-cli-types";
import { jumpToLocation } from "../result-table-utils";

interface Props {
  loc: ResolvableLocationValue;
  label: string;
  databaseUri: string;
  title?: string;
  jumpToLocationCallback?: () => void;
}

/**
 * A clickable location link.
 */
export function ClickableLocation({
  loc,
  label,
  databaseUri,
  title,
  jumpToLocationCallback,
}: Props): JSX.Element {
  const jumpToLocationHandler = useCallback(
    (e: React.MouseEvent) => {
      jumpToLocation(loc, databaseUri);
      e.preventDefault();
      e.stopPropagation();
      jumpToLocationCallback?.();
    },
    [loc, databaseUri, jumpToLocationCallback],
  );

  return (
    <>
      {/*
          eslint-disable-next-line
          jsx-a11y/anchor-is-valid,
        */}
      <a
        href="#"
        className="vscode-codeql__result-table-location-link"
        title={title}
        onClick={jumpToLocationHandler}
      >
        {label}
      </a>
    </>
  );
}
