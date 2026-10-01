import {Await, useLoaderData, Link} from 'react-router';
import type {Route} from './+types/_index';
import {Suspense} from 'react';
import {Image} from '@shopify/hydrogen';
import type {
  FeaturedCollectionFragment,
  RecommendedProductsQuery,
} from 'storefrontapi.generated';
import {ProductItem} from '~/components/ProductItem';
import {MockShopNotice} from '~/components/MockShopNotice';
import {BoxingBoy3D, HERO_MODEL_URL} from '~/components/BoxingBoy3D';

export const meta: Route.MetaFunction = () => {
  return [
    {title: 'KNOCKOUT | Premium Boxing Gloves'},
    {
      name: 'description',
      content:
        'Premium boxing gloves engineered for power, protection and style.',
    },
  ];
};

/**
 * The hero 3D model is the largest above-the-fold asset. Without this it is not
 * requested until the JS bundle and the dynamically imported three.js chunk have
 * both run; preloading starts the download during HTML parse instead.
 * `crossOrigin` must match the fetch mode GLTFLoader uses, or the response is
 * fetched twice instead of being reused.
 */
export const links: Route.LinksFunction = () => [
  {
    rel: 'preload',
    href: HERO_MODEL_URL,
    as: 'fetch',
    type: 'model/gltf-binary',
    crossOrigin: 'anonymous',
  },
];

export async function loader(args: Route.LoaderArgs) {
  // Start fetching non-critical data without blocking time to first byte
  const deferredData = loadDeferredData(args);

  // Await the critical data required to render initial state of the page
  const criticalData = await loadCriticalData(args);

  return {...deferredData, ...criticalData};
}

/**
 * Load data necessary for rendering content above the fold. This is the critical data
 * needed to render the page. If it's unavailable, the whole page should 400 or 500 error.
 */
async function loadCriticalData({context}: Route.LoaderArgs) {
  const [{collections}] = await Promise.all([
    context.storefront.query(FEATURED_COLLECTION_QUERY),
    // Add other queries here, so that they are loaded in parallel
  ]);

  return {
    isShopLinked: Boolean(context.env.PUBLIC_STORE_DOMAIN),
    featuredCollection: collections.nodes[0],
  };
}

/**
 * Load data for rendering content below the fold. This data is deferred and will be
 * fetched after the initial page load. If it's unavailable, the page should still 200.
 * Make sure to not throw any errors here, as it will cause the page to 500.
 */
function loadDeferredData({context}: Route.LoaderArgs) {
  const recommendedProducts = context.storefront
    .query(RECOMMENDED_PRODUCTS_QUERY)
    .catch((error: Error) => {
      // Log query errors, but don't throw them so the page can still render
      console.error(error);
      return null;
    });

  return {
    recommendedProducts,
  };
}

export default function Homepage() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="home">
      {data.isShopLinked ? null : <MockShopNotice />}
      <Hero collection={data.featuredCollection} />
      <FeatureStrip />
      <FeaturedCollection collection={data.featuredCollection} />
      <RecommendedProducts products={data.recommendedProducts} />
    </div>
  );
}

function Hero({collection}: {collection: FeaturedCollectionFragment}) {
  const shopAllUrl = collection
    ? `/collections/${collection.handle}`
    : '/collections/all';
  return (
    <section className="hero">
      <div className="hero-glow" aria-hidden="true" />
      <div className="hero-canvas">
        <BoxingBoy3D />
      </div>
      <div className="hero-content">
        <p className="hero-eyebrow">Premium Fight Gear</p>
        <h1 className="hero-title">
          TRAIN HARD.
          <br />
          <span className="hero-title-accent">HIT HARDER.</span>
        </h1>
        <p className="hero-subtitle">
          Pro-grade boxing gloves built for power, protection and relentless
          rounds in the ring.
        </p>
        <div className="hero-ctas">
          <Link className="hero-cta-primary" to={shopAllUrl}>
            Shop Gloves
          </Link>
          <Link className="hero-cta-secondary" to="/collections/all">
            Explore All Gear
          </Link>
        </div>
      </div>
      <div className="hero-scroll-hint" aria-hidden="true">
        <span />
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: '🥊',
    title: 'Pro-Grade Leather',
    text: 'Full-grain leather shells that break in, never break down.',
  },
  {
    icon: '🛡️',
    title: 'Multi-Layer Foam',
    text: 'Impact-diffusing padding protects your knuckles round after round.',
  },
  {
    icon: '🔒',
    title: 'Locked-In Wrist',
    text: 'Dual-strap support keeps your wrist aligned on every punch.',
  },
  {
    icon: '🚚',
    title: 'Free Shipping',
    text: 'Fast, free delivery on all orders — gear up without the wait.',
  },
];

function FeatureStrip() {
  return (
    <section className="feature-strip" aria-label="Why choose us">
      {FEATURES.map((f) => (
        <div className="feature-card" key={f.title}>
          <span className="feature-icon" aria-hidden="true">
            {f.icon}
          </span>
          <h3>{f.title}</h3>
          <p>{f.text}</p>
        </div>
      ))}
    </section>
  );
}

function FeaturedCollection({
  collection,
}: {
  collection: FeaturedCollectionFragment;
}) {
  if (!collection) return null;
  const image = collection?.image;
  return (
    <section className="featured-section">
      <Link
        className="featured-collection"
        to={`/collections/${collection.handle}`}
      >
        {image && (
          <div className="featured-collection-image">
            <Image
              data={image}
              sizes="100vw"
              alt={image.altText || collection.title}
            />
          </div>
        )}
        <div className="featured-collection-overlay">
          <p className="featured-eyebrow">Featured Collection</p>
          <h2>{collection.title}</h2>
          <span className="featured-link-hint">Shop now →</span>
        </div>
      </Link>
    </section>
  );
}

function RecommendedProducts({
  products,
}: {
  products: Promise<RecommendedProductsQuery | null>;
}) {
  return (
    <section
      className="recommended-products"
      aria-labelledby="recommended-products"
    >
      <div className="section-heading">
        <p className="section-eyebrow">Best Sellers</p>
        <h2 id="recommended-products">Recommended Products</h2>
      </div>
      <Suspense
        fallback={<div className="products-loading">Loading gear…</div>}
      >
        <Await resolve={products}>
          {(response) => (
            <div className="recommended-products-grid">
              {response
                ? response.products.nodes.map((product) => (
                    <ProductItem key={product.id} product={product} />
                  ))
                : null}
            </div>
          )}
        </Await>
      </Suspense>
    </section>
  );
}

const FEATURED_COLLECTION_QUERY = `#graphql
  fragment FeaturedCollection on Collection {
    id
    title
    image {
      id
      url
      altText
      width
      height
    }
    handle
  }
  query FeaturedCollection($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    collections(first: 1, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        ...FeaturedCollection
      }
    }
  }
` as const;

const RECOMMENDED_PRODUCTS_QUERY = `#graphql
  fragment RecommendedProduct on Product {
    id
    title
    handle
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
    }
    featuredImage {
      id
      url
      altText
      width
      height
    }
  }
  query RecommendedProducts ($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    products(first: 4, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        ...RecommendedProduct
      }
    }
  }
` as const;
