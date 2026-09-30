import {useEffect, useState} from 'react';
import {Image} from '@shopify/hydrogen';

export type GalleryImage = {
  id: string;
  url: string;
  altText: string;
  width?: number | null;
  height?: number | null;
};

/**
 * ProductGallery
 * Part 1: large main image. Part 2: thumbnail strip — clicking a thumbnail
 * swaps it into the main view. When the shopper picks a different variant,
 * the main image follows the variant's own image.
 */
export function ProductGallery({
  images,
  selectedImageId,
}: {
  images: GalleryImage[];
  selectedImageId?: string | null;
}) {
  const [active, setActive] = useState(0);

  // follow the selected variant's image when the variant changes
  useEffect(() => {
    if (!selectedImageId) return;
    const i = images.findIndex((img) => img.id === selectedImageId);
    if (i >= 0) setActive(i);
  }, [selectedImageId, images]);

  if (!images.length) {
    return <div className="product-image" />;
  }

  const current = images[Math.min(active, images.length - 1)];

  return (
    <div className="product-gallery">
      <div className="product-gallery-main">
        <Image
          alt={current.altText || 'Product Image'}
          aspectRatio="1/1"
          data={current}
          key={current.id}
          sizes="(min-width: 45em) 50vw, 100vw"
        />
      </div>
      {images.length > 1 ? (
        <div className="product-gallery-thumbs">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              aria-label={`View image ${i + 1} of ${images.length}`}
              className={
                'product-gallery-thumb' + (i === active ? ' active' : '')
              }
              onClick={() => setActive(i)}
            >
              <Image
                alt={img.altText || ''}
                aspectRatio="1/1"
                data={img}
                loading="lazy"
                sizes="110px"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
