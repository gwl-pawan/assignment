/** Modified quick-add.js file to support block structure */

import { morph } from '@theme/morph';
import { Component } from '@theme/component';
import { CartUpdateEvent, ThemeEvents } from '@theme/events';
import { DialogComponent, DialogCloseEvent } from '@theme/dialog';
import { mediaQueryLarge, isMobileBreakpoint, getIOSVersion } from '@theme/utilities';

export class QuickAddComponent extends Component {
  /** @type {AbortController | null} */
  #abortController = null;
  /** @type {Map<string, Element>} */
  #cachedContent = new Map();

  get productPageUrl() {
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest('product-card'));
    const productLink = productCard?.getProductCardLink();

    if (!productLink?.href) return '';

    const url = new URL(productLink.href);

    url.searchParams.set('view', "quick-view");

    if (url.searchParams.has('variant')) {
      return url.toString();
    }

    const selectedVariantId = this.#getSelectedVariantId();
    if (selectedVariantId) {
      url.searchParams.set('variant', selectedVariantId);
    }

    return url.toString();
  }

  /**
   * Gets the currently selected variant ID from the product card
   * @returns {string | null} The variant ID or null
   */
  #getSelectedVariantId() {
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest('product-card'));
    return productCard?.getSelectedVariantId() || null;
  }

  connectedCallback() {
    super.connectedCallback();

    mediaQueryLarge.addEventListener('change', this.#closeQuickAddModal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    mediaQueryLarge.removeEventListener('change', this.#closeQuickAddModal);
    this.#abortController?.abort();
  }

  /**
   * Handles quick add button click
   * @param {Event} event - The click event
   */
  handleClick = async (event) => {
    event.preventDefault();

    const currentUrl = this.productPageUrl;

    let cachedData = this.#cachedContent.get(currentUrl);

    if (!cachedData) {
      const html = await this.fetchProductPage(currentUrl);
      if (html) {
        cachedData = this.#extractProductData(html);
        this.#cachedContent.set(currentUrl, cachedData);
      }
    }

    if (cachedData) {
      await this.updateQuickAddModal(cachedData);
    }

    this.#openQuickAddModal();
  };

  /**
   * Extract Product Data
   * 
   */
  #extractProductData(html) {
    const data = {
      media: html.querySelector('.product-information__media'),
      title: html.querySelector('.product-details h1, .product-details .product-title'),
      price: html.querySelector('product-price'),
      variantPicker: html.querySelector('variant-picker'),
      quantity: html.querySelector('.product-form__quantity, quantity-input'),
      buyButtons: html.querySelector('product-form-component'),
      description: html.querySelector('.product-description, .product-details__description'),
      productForm: html.querySelector('product-form-component'),
      productUrl: this.productPageUrl,
    };

    return data;
  }

  #stayVisibleUntilDialogCloses(dialogComponent) {
    this.toggleAttribute('stay-visible', true);

    dialogComponent.addEventListener(DialogCloseEvent.eventName, () => this.toggleAttribute('stay-visible', false), {
      once: true,
    });
  }

  #openQuickAddModal = () => {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    this.#stayVisibleUntilDialogCloses(dialogComponent);

    dialogComponent.showDialog();
  };

  #closeQuickAddModal = () => {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    dialogComponent.closeDialog();
  };

  /**
   * Fetches the product page content
   * @param {string} productPageUrl - The URL of the product page to fetch
   * @returns {Promise<Document | null>}
   */
  async fetchProductPage(productPageUrl) {
    if (!productPageUrl) return null;

    this.#abortController?.abort();
    this.#abortController = new AbortController();

    try {
      const response = await fetch(productPageUrl, {
        signal: this.#abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch product page: HTTP error ${response.status}`);
      }

      const responseText = await response.text();
      const html = new DOMParser().parseFromString(responseText, 'text/html');

      return html;
    } catch (error) {
      if (error.name === 'AbortError') {
        return null;
      } else {
        throw error;
      }
    } finally {
      this.#abortController = null;
    }
  }

  /**
   * Update modal with block based content
   * 
   */
  async updateQuickAddModal(productData) {
    const modalContent = document.getElementById('quick-add-modal-content');
    const dialogComponent = document.getElementById('quick-add-dialog');

    if (!modalContent || !dialogComponent) return;

    const layout = 'single-column';

    modalContent.classList.add(layout);

    const showMedia = dialogComponent.dataset.showMedia !== 'false';

    const blockConfig = document.getElementById('quick-view-block-config');
    if (!blockConfig) return;

    const blocksConfigElement = blockConfig.content.querySelector('[data-blocks-config]');
    if (!blocksConfigElement) return;

    const container = this.#buildQuickViewContainer(blocksConfigElement, productData, layout, showMedia);

    morph(modalContent, container);

    this.#syncVariantSelection(modalContent);
  }

  /**
   * Build quick view block structure
   * 
   */
  #buildQuickViewContainer(blocksConfig, productData, layout, showMedia) {
    const container = document.createElement('div');
    container.className = `quick-view-container quick-view-container--${layout}`;

    const detailsColumn = document.createElement('div');
    detailsColumn.className = 'quick-view-column quick-view-column--details';

    const blockElements = blocksConfig.querySelectorAll('[data-block-type]');
    blockElements.forEach((blockEl) => {
      const blockType = blockEl.dataset.blockType;
      const blockRole = blockEl.querySelector('[data-block-role]')?.dataset.blockRole;

      if (blockType === 'media' && showMedia) {
        const mediaColumn = document.createElement('div');
        mediaColumn.className = 'quick-view-column quick-view-column--media';

        const blockContent = this.#getBlockContent(blockRole, productData, blockEl);
        if (blockContent) {
          mediaColumn.appendChild(blockContent);
        }

        detailsColumn.appendChild(mediaColumn);

        const galleryEl = mediaColumn.querySelector('.quick-view-media-gallery.swiper');
        if (galleryEl) {
          const nextEl = mediaColumn.querySelector('.quick-view-media-gallery.swiper .swiper-button-next');
          const prevEl = mediaColumn.querySelector('.quick-view-media-gallery.swiper .swiper-button-prev');
          const pagination = mediaColumn.querySelector('.quick-view-media-gallery.swiper .swiper-pagination');
          this.#initQuickViewSwiper(galleryEl, nextEl, prevEl, pagination);
        }
      } else {
        const blockContent = this.#getBlockContent(blockRole, productData, blockEl);
        if (blockContent) {
          detailsColumn.appendChild(blockContent);
        }
      }
    });

    container.appendChild(detailsColumn);

    return container;
  }

  /**
   * Swiper initializer
   * 
   */

  #initQuickViewSwiper(galleryEl, nextEl, prevEl, pagination) {
    if (galleryEl.classList.contains('swiper-initialized')) return;

    new Swiper(galleryEl, {
      slidesPerView: 1,
      spaceBetween: 0,
      loop: true,
      grabCursor: true,
      autoplay: {
        delay: 3000,
        disableOnInteraction: false,
      },
      allowTouchMove: true,
      navigation: {
        nextEl: nextEl,
        prevEl: prevEl,
      },
      pagination: {
        el: pagination,
        clickable: true,
      },
    });

    galleryEl.classList.add('swiper-initialized');
  }



  /**
   * dynamic block content
   * 
   */
  #getBlockContent(blockRole, productData, blockEl) {
    const blockWrapper = blockEl.querySelector(`[data-block-role="${blockRole}"]`)?.cloneNode(true);
    if (!blockWrapper) return null;

    let content = null;

    switch (blockRole) {
      case 'media':
        content = productData.media?.cloneNode(true);
        break;

      case 'title':
        content = productData.title?.cloneNode(true);
        break;

      case 'price':
        content = productData.price?.cloneNode(true);
        break;

      case 'variant_picker':
        content = productData.variantPicker?.cloneNode(true);
        break;

      case 'quantity':
        content = productData.quantity?.cloneNode(true);
        break;

      case 'buy_buttons':
        content = productData.buyButtons?.cloneNode(true);
        break;

      case 'description':
        content = productData.description?.cloneNode(true);
        const showFull = blockEl.querySelector('[data-show-full]')?.dataset.showFull === 'true';
        if (content && !showFull) {
          const text = content.textContent || '';
          if (text.length > 200) {
            content.textContent = text.substring(0, 200) + '...';
          }
        }
        break;

      case 'view_details':
        const link = blockWrapper.querySelector('a');
        if (link) {
          link.href = productData.productUrl;
        }
        return blockWrapper;
    }

    if (content) {
      blockWrapper.innerHTML = '';
      blockWrapper.appendChild(content);
    }

    return blockWrapper;
  }

  /**
   * Syncs the variant selection from the product card to the modal
   * @param {Element} modalContent - The modal content element
   */
  #syncVariantSelection(modalContent) {
    const selectedVariantId = this.#getSelectedVariantId();
    if (!selectedVariantId) return;

    const modalInputs = modalContent.querySelectorAll('input[type="radio"][data-variant-id]');
    for (const input of modalInputs) {
      if (input instanceof HTMLInputElement && input.dataset.variantId === selectedVariantId && !input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    }
  }
}

if (!customElements.get('quick-add-component')) {
  customElements.define('quick-add-component', QuickAddComponent);
}

class QuickAddDialog extends DialogComponent {
  #abortController = new AbortController();

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener(ThemeEvents.cartUpdate, this.handleCartUpdate, { signal: this.#abortController.signal });
    this.addEventListener(ThemeEvents.variantUpdate, this.#updateProductLinks);

    this.addEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController.abort();
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  /**
   * Closes the dialog
   * @param {CartUpdateEvent} event - The cart update event
   */
  handleCartUpdate = (event) => {
    if (event.detail.data.didError) return;
    this.closeDialog();
  };

  #updateProductLinks = (/** @type {CustomEvent} */ event) => {
    const anchorElement = /** @type {HTMLAnchorElement} */ (
      event.detail.data.html?.querySelector('.view-product-title a, .product-title a')
    );
    const viewDetailsLinks = /** @type {NodeListOf<HTMLAnchorElement>} */ (
      this.querySelectorAll('.view-product-details-link, .product-header a')
    );

    if (!anchorElement) return;

    viewDetailsLinks.forEach((link) => {
      link.href = anchorElement.href;
    });
  };

  #handleDialogClose = () => {
    const iosVersion = getIOSVersion();
    /**
     * This is a patch to solve an issue with the UI freezing when the dialog is closed.
     * To reproduce it, use iOS 16.0.
     */
    if (!iosVersion || iosVersion.major >= 17 || (iosVersion.major === 16 && iosVersion.minor >= 4)) return;

    requestAnimationFrame(() => {
      /** @type {HTMLElement | null} */
      const grid = document.querySelector('#ResultsList [product-grid-view]');
      if (grid) {
        const currentWidth = grid.getBoundingClientRect().width;
        grid.style.width = `${currentWidth - 1}px`;
        requestAnimationFrame(() => {
          grid.style.width = '';
        });
      }
    });
  };
}

if (!customElements.get('quick-add-dialog')) {
  customElements.define('quick-add-dialog', QuickAddDialog);
}