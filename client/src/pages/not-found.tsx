import { Tile } from "@carbon/react";
import { Error } from "@carbon/icons-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-10 font-ibm">
      <Tile className="w-full max-w-md mx-4 p-6">
        <div className="flex mb-4 gap-3 items-center">
          <Error size={32} className="text-red-60" />
          <h1 className="text-productive-heading-04 font-semibold text-text-primary">
            404 Page Not Found
          </h1>
        </div>

        <p className="mt-4 text-body-compact-01 text-text-secondary">
          Did you forget to add the page to the router?
        </p>
      </Tile>
    </div>
  );
}
