import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function AppHome() {
  return (
    <s-page heading="Cart Transform Dashboard">
      <s-section heading="Primary Actions">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Manage pricing rule data and activate the cart transform for this store.
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button href="/app/pricing-rules">Pricing rules</s-button>
            <s-button href="/app/activate-transform" variant="secondary">
              Activate transform
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Runtime Data Flow">
        <s-unordered-list>
          <s-list-item>Theme settings to rule JSON/options/slabs</s-list-item>
          <s-list-item>Metaobject rule to product pricing_rule_json metafield</s-list-item>
          <s-list-item>Cart transform function reads product metafield + cart attributes</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
