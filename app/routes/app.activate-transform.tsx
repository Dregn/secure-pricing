import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

type FunctionNode = {
  id: string;
  title: string;
  apiType: string | null;
};

type TransformNode = {
  id: string;
  functionId: string;
  blockOnFailure: boolean;
};

function isCartTransformApiType(value: string | null | undefined) {
  if (!value) return false;
  const normalized = String(value).toLowerCase();
  return normalized === "cart_transform" || normalized === "carttransform";
}

async function getState(admin: any) {
  const fnResp = await admin.graphql(`#
    query ListFunctions {
      shopifyFunctions(first: 50) {
        nodes {
          id
          title
          apiType
        }
      }
    }
  `);
  const fnJson = await fnResp.json();
  const functions: FunctionNode[] = fnJson?.data?.shopifyFunctions?.nodes || [];

  const transformResp = await admin.graphql(`#
    query ListCartTransforms {
      cartTransforms(first: 20) {
        nodes {
          id
          functionId
          blockOnFailure
        }
      }
    }
  `);
  const transformJson = await transformResp.json();
  const transforms: TransformNode[] = transformJson?.data?.cartTransforms?.nodes || [];

  const cartFn = functions.find((f) => isCartTransformApiType(f.apiType));
  const active = cartFn ? transforms.find((t) => t.functionId === cartFn.id) : null;

  return { functions, transforms, cartFn, active };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const state = await getState(admin);

  return {
    shop: session.shop,
    ...state,
    message: "",
    error: "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const state = await getState(admin);

  if (!state.cartFn) {
    return {
      shop: session.shop,
      ...state,
      message: "",
      error:
        "No cart_transform function found. Deploy app function first, then reinstall/update app on this store.",
    };
  }

  if (!state.active) {
    const createResp = await admin.graphql(
      `#
      mutation CreateCartTransform($functionId: String!) {
        cartTransformCreate(functionId: $functionId, blockOnFailure: true) {
          cartTransform {
            id
            functionId
            blockOnFailure
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
      {
        variables: { functionId: state.cartFn.id },
      },
    );
    const createJson = await createResp.json();
    const userErrors = createJson?.data?.cartTransformCreate?.userErrors || [];
    if (userErrors.length) {
      return {
        shop: session.shop,
        ...state,
        message: "",
        error: `cartTransformCreate failed: ${JSON.stringify(userErrors)}`,
      };
    }
  }

  const refreshed = await getState(admin);
  return {
    shop: session.shop,
    ...refreshed,
    message: "Cart transform is active on this store.",
    error: "",
  };
};

export default function ActivateTransformPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const actionData = fetcher.data;

  const message = actionData?.message || data.message;
  const error = actionData?.error || data.error;

  return (
    <s-page heading="Activate Cart Transform">
      <s-section>
        <s-paragraph>
          <s-text>Store: </s-text>
          <s-text>{data.shop}</s-text>
        </s-paragraph>
        <s-paragraph>
          <s-text>Detected cart_transform functions: </s-text>
          <s-text>{String((actionData?.functions || data.functions).length)}</s-text>
        </s-paragraph>
        <s-paragraph>
          <s-text>Existing cartTransforms: </s-text>
          <s-text>{String((actionData?.transforms || data.transforms).length)}</s-text>
        </s-paragraph>
        <s-paragraph>
          <s-text>Active binding: </s-text>
          <s-text>{(actionData?.active || data.active) ? "Yes" : "No"}</s-text>
        </s-paragraph>

        <s-stack direction="inline" gap="base">
          <fetcher.Form method="post">
            <s-button
              type="submit"
              {...(fetcher.state !== "idle" ? { loading: true } : {})}
            >
              Create/Ensure Transform Binding
            </s-button>
          </fetcher.Form>
          <s-button href="/app/activate-transform" variant="tertiary">
            Refresh
          </s-button>
        </s-stack>

        {message ? (
          <s-banner tone="success">
            <s-text>{message}</s-text>
          </s-banner>
        ) : null}
        {error ? (
          <s-banner tone="critical">
            <s-text>{error}</s-text>
          </s-banner>
        ) : null}
      </s-section>
    </s-page>
  );
}

